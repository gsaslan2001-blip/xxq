import { GoogleGenAI } from '@google/genai';
import * as dotenv from 'dotenv';

dotenv.config({ path: '.env.local' });
const apiKey = process.env.GEMINI_API_KEY;

async function checkModels() {
    try {
        const genAI = new GoogleGenAI(apiKey!);
        // The SDK doesn't have a direct listModels, but we can try to find out or just trial-error.
        // Actually, let's just try gemini-1.5-pro.
        console.log("Checking gemini-1.5-pro access...");
        const model = genAI.getGenerativeModel({ model: "gemini-1.5-pro" });
        const result = await model.generateContent("test");
        console.log("gemini-1.5-pro is working.");
    } catch (e: any) {
        console.error("Error with gemini-1.5-pro:", e.message);
    }
    
    try {
        const genAI = new GoogleGenAI(apiKey!);
        console.log("Checking gemini-2.0-flash access...");
        const model = genAI.getGenerativeModel({ model: "gemini-2.0-flash" });
        const result = await model.generateContent("test");
        console.log("gemini-2.0-flash is working.");
    } catch (e: any) {
        console.error("Error with gemini-2.0-flash:", e.message);
    }
}

checkModels();
