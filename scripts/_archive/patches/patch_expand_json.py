import re

path = r'C:\Users\FURKAN\Desktop\Projeler\DUSBANKASI\scripts\notebooklm-expand.py'
with open(path, 'r', encoding='utf-8') as f:
    code = f.read()

# Add the new argument
import_arg_pattern = r'parser\.add_argument\("--min-questions", type=int, default=15, help="Minimum soru sayısı olan üniteleri hedefle \(varsayılan: 15\)"\)'
new_arg = '''parser.add_argument("--min-questions", type=int, default=15, help="Minimum soru sayısı olan üniteleri hedefle (varsayılan: 15)")
    parser.add_argument("--backup-file", default=None, help="Soruları Supabase yerine yerel JSON dosyasından oku")'''
code = code.replace(import_arg_pattern, new_arg)


# Replace the unit gathering and filtering
main_logic_old = '''    # 1. Mevcut üniteleri çek
    units = get_units_for_lesson(lesson)
    if not units:
        print(f"❌ '{lesson}' dersinde hiç ünite bulunamadı.")
        return

    print(f"\\n📋 Bulunan üniteler ({len(units)} adet):")
    for unit, count in units.items():
        marker = "🎯" if count >= args.min_questions else "⏭️"
        print(f"   {marker} [{count:3d} soru] {unit}")

    # Filtreleme
    target_units = {}
    for unit, count in units.items():
        if count < args.min_questions:
            continue
        if args.unit and args.unit.lower() not in unit.lower():
            continue
        target_units[unit] = count

    if not target_units:
        print(f"\\n❌ Kriterlere uyan ünite bulunamadı.")
        return

    print(f"\\n🎯 Hedef üniteler: {len(target_units)} adet")

    # 2. NotebookLM bağlantısı'''

main_logic_new = '''    # 1. Mevcut üniteleri ve soruları al (Yerel veya Supabase)
    local_data = []
    if args.backup_file:
        print(f"📂 Yerel yedek dosyasından okunuyor: {args.backup_file}")
        try:
            with open(args.backup_file, 'r', encoding='utf-8') as f:
                all_backup = json.load(f)
                local_data = [q for q in all_backup if q.get('lesson') == lesson]
                print(f"   ✓ Yerel dosyadan {lesson} dersine ait {len(local_data)} soru yüklendi.")
        except Exception as e:
            print(f"❌ Yerel dosya okuma hatası: {e}")
            return
            
    if args.backup_file:
        from collections import Counter
        units = dict(sorted(Counter(q.get('unit') for q in local_data if q.get('unit')).items()))
    else:
        units = get_units_for_lesson(lesson)
        
    if not units:
        print(f"❌ '{lesson}' dersinde hiç ünite bulunamadı.")
        return

    print(f"\\n📋 Bulunan üniteler ({len(units)} adet):")
    for unit, count in units.items():
        marker = "🎯" if count >= args.min_questions else "⏭️"
        print(f"   {marker} [{count:3d} soru] {unit}")

    # Filtreleme
    target_units = {}
    for unit, count in units.items():
        if count < args.min_questions:
            continue
        if args.unit and args.unit.lower() not in unit.lower():
            continue
        target_units[unit] = count

    if not target_units:
        print(f"\\n❌ Kriterlere uyan ünite bulunamadı.")
        return

    print(f"\\n🎯 Hedef üniteler: {len(target_units)} adet")

    # 2. NotebookLM bağlantısı'''

code = code.replace(main_logic_old, main_logic_new)


# Replace the question fetching in the loop
loop_old = '''            # 2a. O ünitenin tüm sorularını çek
            existing_qs = get_questions_for_unit(lesson, unit_name)'''

loop_new = '''            # 2a. O ünitenin tüm sorularını çek
            if args.backup_file:
                existing_qs = [q for q in local_data if q.get('unit') == unit_name]
            else:
                existing_qs = get_questions_for_unit(lesson, unit_name)'''

code = code.replace(loop_old, loop_new)


with open(path, 'w', encoding='utf-8') as f:
    f.write(code)
print("Applied local backup support patch.")
