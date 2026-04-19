import re
path = r'C:\Users\FURKAN\Desktop\Projeler\DUSBANKASI\scripts\notebooklm-auto.py'
with open(path, 'r', encoding='utf-8') as f:
    text = f.read()

new_q = '''QUEUES = [
    {
        "lesson": "Radyoloji",
        "dir": r"C:\Users\FURKAN\Desktop\DUS\Radyoloji\Yeni klasör\Parcalanmis"
    }
]'''

text = re.sub(r'QUEUES\s*=\s*\[[\s\S]*?\]', new_q, text)

with open(path, 'w', encoding='utf-8') as f:
    f.write(text)
print("Queue patched.")
