import fs from 'fs';

const filePath = 'C:\\Users\\FURKAN\\Desktop\\Yeni Metin Belgesi.txt';
const lesson = 'Endodonti';
const unit = 'Ünite 20 - ENDODONTİK TEDAVİ SONRASI RESTORATİF İŞLEMLER';

const content = fs.readFileSync(filePath, 'utf-8');
const lines = content.split('\n');
const questionsData = [];

for (const line of lines) {
    if (!line.trim()) continue;
    const segments = line.split(';');
    if (segments.length < 2) continue;
    
    const qOpts = segments[0];
    let expl = segments[1].trim();
    
    expl = expl.replace(/<br>/g, '\n').replace(/<\/?b>/g, '').trim();
    const correctMatch = expl.match(/Doğru Cevap:\s*([A-E])\)/i);
    const correctAnswer = correctMatch ? correctMatch[1].toUpperCase() : 'A';
    expl = expl.replace(/^Doğru Cevap:.*?\n+/i, '').trim();
    
    // Using a simpler regex that matches everything up to the first <br>A)
    const qMatch = qOpts.match(/^\d+\.\s*(.*?)(?=<br>[A-Z]\))/is);
    const questionText = qMatch ? qMatch[1].replace(/<br>/g, '\n').trim() : qOpts;
    
    const options = {};
    const letters = ['A', 'B', 'C', 'D', 'E'];
    for (let i = 0; i < letters.length; i++) {
        const letter = letters[i];
        const isLast = i === letters.length - 1;
        const regexStr = isLast ? `<br>${letter}\\)\\s*(.*)$` : `<br>${letter}\\)\\s*(.*?)(?=<br>[A-Z]\\))`;
        const regex = new RegExp(regexStr, 'is');
        const optMatch = qOpts.match(regex);
        if (optMatch) {
            options[letter] = optMatch[1].replace(/<br>/g, '\n').trim();
        }
    }
    
    questionsData.push({
        id: `q${questionsData.length + 1}`,
        lesson,
        unit,
        question: questionText,
        options,
        correctAnswer,
        explanation: expl
    });
}

const tsContent = `export type Question = {
  id: string;
  lesson: string;
  unit: string;
  question: string;
  options: Record<string, string>;
  correctAnswer: string;
  explanation: string;
};

export const sampleData: Question[] = ${JSON.stringify(questionsData, null, 2)};
`;

fs.writeFileSync('C:\\Users\\FURKAN\\Desktop\\DUSBANKASI\\src\\data.ts', tsContent, 'utf-8');
