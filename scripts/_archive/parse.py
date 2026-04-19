import json
import re

file_path = r'C:\Users\FURKAN\Desktop\Yeni Metin Belgesi.txt'
lesson = "Endodonti"
unit = "Ünite 20 - ENDODONTİK TEDAVİ SONRASI RESTORATİF İŞLEMLER"

with open(file_path, 'r', encoding='utf-8') as f:
    content = f.read()

lines = content.split('\n')
questions_data = []

for line in lines:
    if not line.strip():
        continue
    
    segments = line.split(';')
    if len(segments) < 2:
        continue
        
    q_with_opts = segments[0]
    explanation = segments[1].strip()
    
    # Clean up explanation HTML tags mostly, except maybe keep newlines if we want, but removing <br> is better for text mode, or keeping them inside react. The app uses whitespace-pre-wrap so we should replace <br> with \n
    explanation = explanation.replace('<br>', '\n').replace('<b>', '').replace('</b>', '').strip()
    
    # Question text
    q_match = re.search(r'^\d+\.\s*(.*?)(?=<br>[A-E]\))', q_with_opts, re.IGNORECASE | re.DOTALL)
    if q_match:
        question_text = q_match.group(1).replace('<br>', '\n').strip()
    else:
        question_text = q_with_opts
        
    options = {}
    for letter in ['A', 'B', 'C', 'D', 'E']:
        opt_match = re.search(rf'<br>{letter}\)\s*(.*?)(?=<br>[A-Z]\)|$)', q_with_opts, re.IGNORECASE | re.DOTALL)
        if opt_match:
            options[letter] = opt_match.group(1).replace('<br>', '\n').strip()
            
    # Correct Answer
    correct_match = re.search(r'Doğru Cevap:\s*([A-E])\)', explanation, re.IGNORECASE)
    correct_answer = correct_match.group(1).upper() if correct_match else "A"
    
    # Remove "Doğru Cevap: X) Text\n\n" from explanation
    explanation = re.sub(r'^Doğru Cevap:.*?\n+', '', explanation, flags=re.IGNORECASE).strip()
    
    questions_data.append({
        "id": f"q{len(questions_data) + 1}",
        "lesson": lesson,
        "unit": unit,
        "question": question_text,
        "options": options,
        "correctAnswer": correct_answer,
        "explanation": explanation
    })

ts_content = "export type Question = {\n  id: string;\n  lesson: string;\n  unit: string;\n  question: string;\n  options: Record<string, string>;\n  correctAnswer: string;\n  explanation: string;\n};\n\nexport const sampleData: Question[] = "
ts_content += json.dumps(questions_data, ensure_ascii=False, indent=2)
ts_content += ";\n"

with open(r'C:\Users\FURKAN\Desktop\DUSBANKASI\src\data.ts', 'w', encoding='utf-8') as f:
    f.write(ts_content)

print(f"Successfully wrote {len(questions_data)} questions to src/data.ts")
