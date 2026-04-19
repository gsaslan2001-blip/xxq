import { GoogleGenAI } from '@google/genai';
import * as dotenv from 'dotenv';

dotenv.config({ path: '.env.local' });
const apiKey = process.env.GEMINI_API_KEY;

async function checkPro() {
    try {
        const genAI = new GoogleGenAI({ apiKey: apiKey });
        console.log("Checking gemini-3.1-pro (no preview suffix)...");
        const chat = genAI.chats.create({ model: "gemini-3.1-pro" });
        await chat.sendMessage({ message: "test" });
        console.log("gemini-3.1-pro is working.");
    } catch (e: any) {
        console.error("Error with gemini-3.1-pro:", e.message);
    }
}

checkPro();
