import importlib.util
from pathlib import Path
s=importlib.util.spec_from_file_location('upd',Path(__file__).resolve().parents[1]/'scripts/update_data.py')
u=importlib.util.module_from_spec(s)
s.loader.exec_module(u)
raw={'nodes':[{'column':0,'item_id':5,'matches':500,'wins':280,'adjusted_win_rate':0.54,'pick_rate':0.25},{'column':1,'item_id':5,'matches':900,'wins':515,'adjusted_win_rate':56.2}, {'column':10,'item_id':99,'matches':1}], 'reached_per_column':[1000,800], 'reached_wins_per_column':[520,430]}
items,base,wins=u.parse_flow(raw)
assert len(items)==2 and (0,5) in items and (1,5) in items
assert round(items[(1,5)]['adjusted'],3)==0.562
assert base==[1000,800]
print('PASS Python updater: response parsing, win rates, invalid phase filters')
