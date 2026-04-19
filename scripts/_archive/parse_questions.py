import json
import re

file_path = r'C:\Users\FURKAN\Desktop\Yeni Metin Belgesi.txt'
lesson = "Endodonti"
unit = "Ünite 20 - ENDODONTİK TEDAVİ SONRASI RESTORATİF İŞLEMLER"

with open(file_path, 'r', encoding='utf-8') as f:
    content = f.read()

# Each question starts with "N. " where N is a number
# But looking at the file, it's delimited by ";" and then category tags
lines = content.split('\n')
questions_data = []

# The format seems to be:
# [Question text with options separated by <br>] ; [Explanation] ; [Category]
# Example: 1. Question...<br>A)...<br>B)... ; Doğru Cevap: ... ; DUS::...

parts = content.split('DUS::')
# The "DUS::" part is the end of each question block usually.
# Let's try splitting by ";" which seems to be the main separator.

raw_entries = []
# Each question block is something like:
# N. Question text...<br>A)...<br>B)...<br>C)...<br>D)...<br>E)... ; Correct Answer & Expl ; Category
# The category is usually the last part.

# Let's use a regex to find the blocks starting with number
# Actually, the file has 30 questions.
# Let's split by empty lines or just line by line since it seems every question is on one line?
# Checking the view_file output...
# 1: 1. Endodontik...;Doğru Cevap...;DUS...
# 2: (empty)
# 3: 2. 35 yaşında...;Doğru Cevap...;DUS...
# Yes, each question + options + expl + cat is on a single line in the original file.

for line in lines:
    if not line.strip():
        continue
    
    # Split by ";"
    # Format: QuestionWithOpts ; Explanation ; Category
    segments = line.split(';')
    if len(segments) < 2:
        continue
        
    q_with_opts = segments[0]
    explanation = segments[1]
    
    # Parse question and options
    # "1. Text... <br>A) Opt A<br>B) Opt B..."
    match = re.search(r'^\d+\.\s*(.*?)(?=<br>A\))', q_with_opts, re.IGNORECASE | re.DOTALL)
    if not match:
        # Try a more flexible match
        match = re.search(r'^\d+\.\s*(.*?)(?=<br>[A-E]\))', q_with_opts, re.IGNORECASE | re.DOTALL)
    
    if match:
        question_text = match.group(1).strip()
    else:
        question_text = q_with_opts # Fallback
        
    options = {}
    for letter in ['A', 'B', 'C', 'D', 'E']:
        opt_match = re.search(rf'<br>{letter}\)\s*(.*?)(?=<br>[A-Z]\)|$)', q_with_opts, re.IGNORECASE | re.DOTALL)
        if opt_match:
            options[letter] = opt_match.group(1).strip()
            
    # Parse Correct Answer from Explanation
    # "Doğru Cevap: D) Direkt kompozit"
    correct_match = re.search(r'Doğru Cevap:\s*([A-E])\)', explanation, re.IGNORECASE)
    correct_answer = correct_match.group(1) if correct_match else "A"
    
    questions_data.append({
        "id": len(questions_data) + 1,
        "lesson": lesson,
        "unit": unit,
        "question": question_text,
        "options": options,
        "correctAnswer": correct_answer,
        "explanation": explanation
    })

print(json.dumps(questions_data, ensure_ascii=False, indent=2))
