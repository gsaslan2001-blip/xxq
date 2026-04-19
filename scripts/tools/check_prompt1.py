path = r'C:\Users\FURKAN\Desktop\Projeler\DUSBANKASI\scripts\notebooklm-auto.py'
with open(path, 'r', encoding='utf-8') as f:
    content = f.read()

# Find PROMPT_1 boundaries using the module
import sys
sys.path.insert(0, r'C:\Users\FURKAN\Desktop\Projeler\DUSBANKASI\scripts')

# Import the module to check PROMPT_1
ns = {}
# Just extract PROMPT_1 value by executing the constants section
exec(content.split('PROMPT_2')[0].split('QUEUES')[0], ns)

p1 = ns.get('PROMPT_1', '')
print(f'PROMPT_1 length: {len(p1)} chars, ~{len(p1.splitlines())} lines')

checks = ['HbA1c', 'Sefalometrik', 'MRONJ', 'Goldenhar', 'KAS form', 'Periodontoloji', 'Ünite adı', 'KULLANIM']
for c in checks:
    print(f'  {c}: {"VAR ✓" if c in p1 else "YOK ✗"}')
