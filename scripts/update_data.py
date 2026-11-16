#!/usr/bin/env python3
"""Build a compact per-hero snapshot from aggregate Deadlock API endpoints.

This downloads statistical *summaries*, not millions of raw matches. One 365-day
and one 30-day request per hero, unless --quick is supplied.
"""
import argparse
import datetime as dt
import json
import pathlib
import sys
import time
import urllib.error
import urllib.parse
import urllib.request

ROOT = pathlib.Path(__file__).resolve().parents[1]
API = 'https://api.deadlock-api.com'
USER_AGENT = 'Nightshift-CommunityAdvisor/0.1 (static snapshot builder)'
HEROES = [6,77,15,72,16,81,78,64,11,76,17,13,14,1,20,12,4,31,8,63,52,18,87,67,10,50,84,79,2,19,80,60,85,69,65,66,3,35,58,25,7,27]


def get_json(path, params=None, retries=3):
    url = API+path+('?' + urllib.parse.urlencode(params) if params else '')
    for attempt in range(retries):
        try:
            request = urllib.request.Request(url, headers={'User-Agent':USER_AGENT,'Accept':'application/json'})
            with urllib.request.urlopen(request, timeout=60) as res:
                return json.load(res)
        except (urllib.error.URLError, TimeoutError, json.JSONDecodeError) as e:
            print(f'  retry {attempt+1}/{retries}: {e}', file=sys.stderr)
            if attempt == retries-1:
                raise
            time.sleep(min(30, 3*(attempt+1)**2))


def normalize_rate(raw):
    if raw is None:
        return None
    try:
        r = float(raw)
    except (TypeError,ValueError):
        return None
    return max(0, min(1, r/100 if r>1 else r))


def parse_flow(raw):
    if not isinstance(raw,dict) or not isinstance(raw.get('nodes'),list):
        raise ValueError('Missing nodes in item-flow response')
    nodes={}
    for n in raw['nodes']:
        if not isinstance(n,dict):
            continue
        try:
            phase=int(n.get('column', n.get('phase', n.get('stage', -1))))
            item=int(n.get('item_id', 0))
            matches=int(n.get('matches', n.get('purchases',n.get('players',0))))
            wins=int(n.get('wins', 0))
        except (TypeError,ValueError):
            continue
        if not (0<=phase<4 and item>0 and matches>=1):
            continue
        nodes[(phase,item)]={
            'stage':phase,'id':item,'matches':matches,'wins':wins,
            'adjusted':normalize_rate(n.get('adjusted_win_rate')),
            'raw':normalize_rate(n.get('win_rate')) if n.get('win_rate') is not None else (wins/matches if n.get('wins') is not None else None),
            'pick':normalize_rate(n.get('pick_rate',n.get('purchase_rate'))),
        }
    return nodes,raw.get('reached_per_column',[]),raw.get('reached_wins_per_column',[])


def fetch_flow(hero,days):
    start=int((dt.datetime.now(dt.timezone.utc)-dt.timedelta(days=days)).timestamp())
    return parse_flow(get_json('/v1/analytics/item-flow-stats',{
        'hero_ids':str(hero),'game_mode':'normal','min_unix_timestamp':start,'min_matches':25
    }))


def catalog():
    data=get_json('/v1/assets/items/by-type/upgrade')
    if not isinstance(data,list):
        raise ValueError('Item API did not return a list')
    out=[]
    for i in data:
        if not isinstance(i,dict):continue
        identity=i.get('id',i.get('item_id'))
        if identity is None:continue
        try: identity=int(identity)
        except (TypeError,ValueError):continue
        out.append({'id':identity,'name':str(i.get('name',i.get('display_name',f'Item {identity}'))),
                    'cost':i.get('cost',i.get('shop_cost',0)),
                    'type':str(i.get('item_slot_type',i.get('slot_type',i.get('shop_category','vitality')))).lower()})
    return out


def emit(path,data):
    path.parent.mkdir(parents=True,exist_ok=True)
    path.write_text(json.dumps(data,ensure_ascii=False,separators=(',',':')),encoding='utf-8')


def main():
    p=argparse.ArgumentParser(description=__doc__)
    p.add_argument('--quick',action='store_true',help='Only 30-day stats, one request per hero')
    p.add_argument('--hero',type=int,action='append',help='Limit to a hero ID (repeatable)')
    args=p.parse_args()
    stamp=dt.datetime.now(dt.timezone.utc).isoformat()
    try:
        items=catalog()
        if not items:raise ValueError('Empty item catalog')
        emit(ROOT/'data/catalog.json',{'updated':stamp,'items':items})
        print(f'Item metadata: {len(items)} items')
    except Exception as e:
        print(f'Catalog update failed; old catalog retained: {e}',file=sys.stderr)
    succeeded=[]
    for hero in (args.hero or HEROES):
        print(f'Hero {hero}: fetching summaries…',flush=True)
        try:
            recent,base,base_wins=fetch_flow(hero,30)
            nodes=recent
            if not args.quick:
                historical,_,_=fetch_flow(hero,365)
                merged={}
                # Keep the last 30 days as the primary signal; use older results
                # to steady rare-item estimates without pretending counts are additive.
                for key in set(historical)|set(recent):
                    r=recent.get(key)
                    old=historical.get(key)
                    if r is None and old is None:continue
                    primary=dict(r or old)
                    if r and old and r.get('adjusted') is not None and old.get('adjusted') is not None:
                        weight=min(.85,max(.35,r['matches']/(r['matches']+700)))
                        primary['adjusted']=round(weight*r['adjusted']+(1-weight)*old['adjusted'],6)
                        primary['recent_matches']=r['matches']
                        primary['year_matches']=old['matches']
                    elif old and not r:
                        # Older-only items are useful for reference, but not current picks.
                        continue
                    merged[key]=primary
                nodes=merged
            if len(nodes)==0:
                raise ValueError('No supported item phase records received')
            output={'updated':stamp,'window_days':30 if args.quick else 365,'nodes':list(nodes.values()),'baseline':base,'baselineWins':base_wins}
            emit(ROOT/f'data/heroes/{hero}.json',output)
            succeeded.append(hero)
            print(f'  saved {len(nodes)} phase/item records')
        except Exception as e:
            print(f'  failed, previous snapshot kept: {e}',file=sys.stderr)
        time.sleep(.8)
    available=[]
    for p in (ROOT/'data/heroes').glob('*.json'):
        try:
            content=json.loads(p.read_text(encoding='utf-8'))
            if isinstance(content.get('nodes'),list) and content['nodes']:
                available.append(int(p.stem))
        except (ValueError,TypeError,OSError,AttributeError):
            pass
    emit(ROOT/'data/manifest.json',{'updated':stamp,'heroes_updated':succeeded,'heroes_available':sorted(available),'lookback_days':30 if args.quick else 365})
    print(f'Done: {len(succeeded)} heroes successfully refreshed')
    if not succeeded:sys.exit(1)

if __name__=='__main__':main()
