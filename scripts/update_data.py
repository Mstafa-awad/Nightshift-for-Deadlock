#!/usr/bin/env python3
"""Build small per-hero Deadlock statistics safely.

Fail-fast on upstream 502/503/504 outages, preserve earlier data and resume on the
next run. Use --quick in GitHub Actions to avoid slow 365-day queries.
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


class APIUnavailable(Exception):
    """The public API is overloaded or temporarily unavailable."""


def get_json(path, params=None, retries=1, timeout=12):
    url = API + path + ('?' + urllib.parse.urlencode(params) if params else '')
    request = urllib.request.Request(url, headers={
        'User-Agent': USER_AGENT, 'Accept': 'application/json'
    })
    for attempt in range(retries):
        try:
            with urllib.request.urlopen(request, timeout=timeout) as res:
                return json.load(res)
        except urllib.error.HTTPError as exc:
            # 504 = Deadlock API server timeout, NOT an error in your PC.
            # Don't retry the same expensive query over and over.
            if exc.code in (429, 500, 502, 503, 504):
                raise APIUnavailable(f'API HTTP {exc.code} ({path})') from exc
            raise
        except (urllib.error.URLError, TimeoutError, OSError) as exc:
            if attempt + 1 >= retries:
                raise APIUnavailable(f'API connection timeout ({path}): {exc}') from exc
            time.sleep(1)


def recent_snapshot(path, max_age_hours=24):
    """Skip recently saved heroes, allowing subsequent runs to resume."""
    try:
        data = json.loads(path.read_text(encoding='utf-8'))
        stamp = dt.datetime.fromisoformat(data['updated'].replace('Z', '+00:00'))
        age = (dt.datetime.now(dt.timezone.utc) - stamp).total_seconds()
        return isinstance(data.get('nodes'), list) and bool(data['nodes']) and 0 <= age < max_age_hours * 3600
    except (OSError, ValueError, TypeError, KeyError, AttributeError):
        return False


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


def fetch_flow(hero, days, timeout=12):
    # Align to the hour to reuse the API's 1-hour query cache on repeat runs.
    now_hour = (int(dt.datetime.now(dt.timezone.utc).timestamp()) // 3600) * 3600
    start = now_hour - days * 86400
    return parse_flow(get_json('/v1/analytics/item-flow-stats', {
        'hero_ids': str(hero), 'game_mode': 'normal',
        'min_unix_timestamp': start, 'min_matches': 25
    }, timeout=timeout))


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
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument('--quick', action='store_true', help='One recent request per hero; no 365-day queries')
    p.add_argument('--hero', type=int, action='append', help='Limit to a hero ID (repeatable)')
    p.add_argument('--days', type=int, default=14, help='Recent window for --quick (default: 14 days)')
    p.add_argument('--timeout', type=int, default=12, help='Seconds before abandoning a slow API request')
    p.add_argument('--max-failures', type=int, default=2, help='Stop after this many consecutive failed heroes')
    p.add_argument('--force', action='store_true', help='Refetch even fresh hero snapshots')
    args = p.parse_args()
    if args.days < 1 or args.timeout < 1 or args.max_failures < 1:
        p.error('--days, --timeout and --max-failures must be positive')
    stamp = dt.datetime.now(dt.timezone.utc).isoformat()
    try:
        items = catalog()
        if not items:
            raise ValueError('Empty item catalog')
        emit(ROOT / 'data/catalog.json', {'updated': stamp, 'items': items})
        print(f'Item metadata: {len(items)} items', flush=True)
    except Exception as exc:
        print(f'Catalog unavailable, preserving existing file: {exc}', flush=True)

    succeeded, skipped, failures = [], [], 0
    heroes = args.hero or HEROES
    for hero in heroes:
        output_path = ROOT / 'data/heroes' / f'{hero}.json'
        if not args.force and recent_snapshot(output_path):
            skipped.append(hero)
            print(f'Hero {hero}: cached data is fresh — skipping', flush=True)
            continue
        print(f'Hero {hero}: fetching {args.days if args.quick else 30}-day stats...', flush=True)
        try:
            recent, base, base_wins = fetch_flow(hero, args.days if args.quick else 30, args.timeout)
            nodes = recent
            window = args.days if args.quick else 365
            if not args.quick:
                historical, _, _ = fetch_flow(hero, 365, args.timeout)
                merged = {}
                for key in set(historical) | set(recent):
                    r = recent.get(key)
                    old = historical.get(key)
                    if r is None:
                        continue
                    primary = dict(r)
                    if old and r.get('adjusted') is not None and old.get('adjusted') is not None:
                        weight = min(.85, max(.35, r['matches'] / (r['matches'] + 700)))
                        primary['adjusted'] = round(weight * r['adjusted'] + (1-weight) * old['adjusted'], 6)
                        primary['recent_matches'] = r['matches']
                        primary['year_matches'] = old['matches']
                    merged[key] = primary
                nodes = merged
            if not nodes:
                raise ValueError('API returned no usable item phase records')
            emit(output_path, {
                'updated': stamp, 'window_days': window,
                'nodes': list(nodes.values()), 'baseline': base, 'baselineWins': base_wins
            })
            succeeded.append(hero)
            failures = 0  # A successful call resets the outage detector.
            print(f'  saved {len(nodes)} phase/item records', flush=True)
        except (APIUnavailable, urllib.error.HTTPError, ValueError, json.JSONDecodeError) as exc:
            failures += 1
            print(f'  failed ({failures}/{args.max_failures}): {exc}; old file preserved', flush=True)
            if failures >= args.max_failures:
                print('API seems overloaded. Stopping requests early; site can still deploy.', flush=True)
                break
        # No unnecessary delays once the API is responding.

    available = []
    for path in (ROOT / 'data/heroes').glob('*.json'):
        try:
            content = json.loads(path.read_text(encoding='utf-8'))
            if isinstance(content.get('nodes'), list) and content['nodes']:
                available.append(int(path.stem))
        except (ValueError, TypeError, OSError, AttributeError):
            pass
    old_manifest = {}
    try:
        old_manifest = json.loads((ROOT / 'data/manifest.json').read_text(encoding='utf-8'))
    except (OSError, json.JSONDecodeError):
        pass
    # Never claim all snapshots were refreshed just because this partial run ended.
    emit(ROOT / 'data/manifest.json', {
        'updated': stamp if succeeded else old_manifest.get('updated'),
        'heroes_updated': succeeded,
        'heroes_available': sorted(available),
        'lookback_days': args.days if args.quick else 365
    })
    print(f'Done: {len(succeeded)} updated, {len(skipped)} already fresh, '
          f'{len(available)} total heroes available.', flush=True)
    # Always exit normally so a temporary third-party outage NEVER blocks Pages.
    return 0


if __name__ == '__main__':
    sys.exit(main())
