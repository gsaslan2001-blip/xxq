import re

path = r'C:\Users\FURKAN\Desktop\Projeler\DUSBANKASI\scripts\notebooklm-auto.py'

with open(path, 'r', encoding='utf-8') as f:
    code = f.read()

# 1. extract_json fonksiyonunu güncelle
old_extract = '''def extract_json(text):
    """Regex ile JSON bloğunu çeker."""
    def clean_and_parse(json_str):
        # trailing comma fix
        json_str = re.sub(r',\\s*([\\]}])', r'\\1', json_str)
        return json.loads(json_str)

    try:
        match = re.search(r'```json\\n([\\s\\S]*?)\\n```', text)
        if match: return clean_and_parse(match.group(1).strip())
        match = re.search(r'\\[\\s*\\{[\\s\\S]*\\}\\s*\\]', text)
        if match: return clean_and_parse(match.group(0).strip())
    except Exception as e:
        print(f"JSON Parse Hatası: {e}")
    return None'''

new_extract = '''def extract_json(text):
    """Regex ile JSON bloğunu çeker."""
    if not text: return None
    def clean_and_parse(json_str):
        # trailing comma fix
        json_str = re.sub(r',\\s*([\\]}])', r'\\1', json_str)
        return json.loads(json_str)

    try:
        # Önce markdown bloğunu ara
        match = re.search(r'```(?:json)?\\s*\\n([\\s\\S]*?)\\n```', text)
        if match:
            try: return clean_and_parse(match.group(1).strip())
            except Exception: pass
            
        # Olmazsa en geniş array'i bul
        match = re.search(r'\\[\\s*\\{[\\s\\S]*\\}\\s*\\]', text)
        if match:
            return clean_and_parse(match.group(0).strip())
    except Exception as e:
        print(f"JSON Parse Hatası: {e}")
        
    return None'''

if 'def extract_json' in code:
    pattern_extract = r'def extract_json.*?return None'
    code = re.sub(pattern_extract, new_extract, code, flags=re.DOTALL)

# 2. Main döngüsündeki atlama mantığını güncelle
old_skip = '''                if unit_name in existing_units:
                    print(f"⏭️ {unit_name} ÜNİTESİ ZATEN MEVCUT (SKIPPED).")
                    continue'''

new_skip = '''                tur1_exists = unit_name in existing_units
                tur2_exists = (unit_name + " - Deep Dive") in existing_units
                
                if tur1_exists and tur2_exists:
                    print(f"⏭️ {unit_name} EKSİKSİZ MEVCUT (Tur 1 ve Tur 2). ATLANMIYOR.")
                    continue
                elif tur1_exists:
                    print(f"⚠️ {unit_name} Tur 1 mevcut, ancak Tur 2 EKSİK. Tamamlama modunda açılıyor.")
                elif tur2_exists:
                    print(f"⚠️ {unit_name} Tur 2 mevcut, ancak Tur 1 EKSİK. Tamamlama modunda açılıyor.")'''

code = code.replace(old_skip, new_skip)

# 3. Deploy kısmındaki if statements'ları güncelle
old_deploy_t1 = '''                        # Tur 1 sonuçlarını hemen kaydet (güvenli checkpoint)
                        if questions1:
                            print(f"💾 Tur 1 checkpoint: {len(questions1)} soru kaydediliyor...")
                            deploy_to_supabase(questions1, lesson, unit_name)'''

new_deploy_t1 = '''                        # Tur 1 sonuçlarını hemen kaydet (güvenli checkpoint)
                        if questions1 and not tur1_exists:
                            print(f"💾 Tur 1 checkpoint: {len(questions1)} soru kaydediliyor...")
                            deploy_to_supabase(questions1, lesson, unit_name)
                        elif tur1_exists:
                            print(f"⏭️ Tur 1 zaten veritabanında var, üstüne yazılmıyor.")'''

code = code.replace(old_deploy_t1, new_deploy_t1)

old_deploy_t2 = '''                        # 3.5 TUR 2: DEEP DIVE (Bağlamı pekiştirmek için kısa bekleme)
                        print("⏳ API bağlamı işliyor, 5 saniye bekleniyor...")
                        await asyncio.sleep(5)
                        print("🧠 Tur 2: Deep-Dive Prompt iletiliyor...")
                        try:
                            res2 = await asyncio.wait_for(
                                client.chat.ask(NOTEBOOK_ID, PROMPT_2, conversation_id=fresh_conv_id),
                                timeout=600
                            )
                            questions2 = extract_json(res2.answer) or []
                            print(f"   - Tur 2 tamamlandı: {len(questions2)} soru.")

                            # Tur 2 sonuçlarını ayrıca kaydet (duplicate önlemek için unit_name_2)
                            if questions2:
                                print(f"💾 Tur 2: {len(questions2)} ek soru kaydediliyor...")
                                deploy_to_supabase(questions2, lesson, unit_name + " - Deep Dive")
                        except Exception as e2:
                            print(f"⚠️ Tur 2 başarısız (Tur 1 zaten kaydedildi): {e2}")'''

new_deploy_t2 = '''                        # 3.5 TUR 2: DEEP DIVE (Bağlamı pekiştirmek için kısa bekleme)
                        if not tur2_exists:
                            print("⏳ API bağlamı işliyor, 5 saniye bekleniyor...")
                            await asyncio.sleep(5)
                            print("🧠 Tur 2: Deep-Dive Prompt iletiliyor...")
                            try:
                                res2 = await asyncio.wait_for(
                                    client.chat.ask(NOTEBOOK_ID, PROMPT_2, conversation_id=fresh_conv_id),
                                    timeout=600
                                )
                                questions2 = extract_json(res2.answer) or []
                                print(f"   - Tur 2 tamamlandı: {len(questions2)} soru.")

                                # Tur 2 sonuçlarını ayrıca kaydet (duplicate önlemek için unit_name_2)
                                if questions2:
                                    print(f"💾 Tur 2: {len(questions2)} ek soru kaydediliyor...")
                                    deploy_to_supabase(questions2, lesson, unit_name + " - Deep Dive")
                            except Exception as e2:
                                print(f"⚠️ Tur 2 başarısız: {e2}")
                        else:
                            print("⏭️ Tur 2 (Deep Dive) zaten veritabanında var, üstüne yazılmıyor.")'''

code = code.replace(old_deploy_t2, new_deploy_t2)

with open(path, 'w', encoding='utf-8') as f:
    f.write(code)

print("Robustness update applied successfully.")
