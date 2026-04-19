import re
path = r'C:\Users\FURKAN\Desktop\Projeler\DUSBANKASI\scripts\notebooklm-auto.py'
with open(path, 'r', encoding='utf-8') as f:
    code = f.read()

new_prompt_1 = '''PROMPT_1 = r"""Defalarca test ettiğimiz ve bu defterin "Sohbeti Yapılandırın (Özel)" ayarlarına yüklenmiş olan DUS Soru Yazarı (Master Prompt) kuralları devrededir.

Lütfen o ayarlardaki TÜM kalite kurallarına, <analiz> protokolüne ve spesifik JSON çıktısına harfiyen uyarak, sadece sana verdiğim bu kaynaktan ilk 30 soruluk ağırlık merkezleri (Batch 1, 2, 3) setini üret.
"""'''

new_prompt_2 = '''PROMPT_2 = r"""Bu bir DEVAM TURU'dur (Deep-Dive).
Sistem ayarlarındaki tüm Master Prompt kuralları (JSON formatı, zorluk dağılımı, distraktör yazım kuralları vb.) aynen geçerlidir.

ANCAK ŞUNLARA DİKKAT ET:
1. İlk sette (Az önceki yanıtta) işlenmiş olan ana kavramları BİRİNCİL TEST NESNESİ OLARAK KULLANMA.
2. Sadece kaynağın hiç dokunulmamış bölgelerine, kuytu köşe bilgilerine, tablolara, dipnotlara, istisnalara odaklan.
3. Bu yeni (dokunulmamış) konseptlerden 30 adet yepyeni zorluk hedefli soru üret.

Önce <analiz> etiketinde hangi kavramları elediğini ve hangi yeni kavramları seçtiğini planla, ardından taze JSON dizisini üret.
"""'''

# Extract the existing PROMPT_1 and PROMPT_2 cleanly
code = re.sub(r"PROMPT_1\s*=\s*r'''(.*?)'''", new_prompt_1, code, flags=re.DOTALL)
code = re.sub(r"PROMPT_2\s*=\s*r'''(.*?)'''", new_prompt_2, code, flags=re.DOTALL)

with open(path, 'w', encoding='utf-8') as f:
    f.write(code)

print("Short prompts injected via Python patch successfully.")
