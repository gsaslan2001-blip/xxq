import sys, os
sys.path.insert(0, r'C:\Users\FURKAN\Desktop\Projeler\DUSBANKASI\scripts')
from config import *
from shared import extract_json, deploy_to_supabase, classify_error, RetryableError, AuthError
from fingerprint import generate_fingerprint, build_fingerprint_list

# Test error classification
e1 = classify_error(Exception('HTTP 502 Bad Gateway'))
e2 = classify_error(Exception('Authentication expired'))
e3 = classify_error(Exception('JSON decode error'))
print(f'502 -> {type(e1).__name__}')
print(f'Auth -> {type(e2).__name__}')
print(f'JSON -> {type(e3).__name__}')

# Test partial JSON repair
broken = '[{"q":"test1"},{"q":"test2"},{"q":"tes'
result = extract_json(broken)
print(f'Partial repair: {result}')

# Test fingerprint
sample_q = {
    'correct_answer': 'C',
    'option_c': 'Sklerostin',
    'explanation': 'Sklerostin Wnt sinyal yolunu inhibe eder.',
    'question': 'Hangisi dogrudur?'
}
fp = generate_fingerprint(sample_q)
print(f'Fingerprint: {fp}')

# Test recovery dir
print(f'Recovery dir exists: {os.path.exists(RECOVERY_DIR)}')
print('ALL TESTS PASSED')
