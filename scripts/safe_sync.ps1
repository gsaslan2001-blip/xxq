# DUS Bankası — Güvenli Yayın ve Yedekleme Otomasyonu (safe_sync)
# Bu script: Build kontrolü yapar, Yedek alır ve Vercel'e Deploy eder.

$ErrorActionPreference = "Stop"

# 1. Klasör ve Dosya Yolları
$ProjectRoot = "c:\Users\FURKAN\Desktop\Projeler\DUSBANKASI"
$BackupRoot = "c:\Users\FURKAN\Desktop\Projeler\DUSBANKASI_BACKUPS"
$Timestamp = Get-Date -Format "yyyyMMdd_HHmm"
$CurrentBackupDir = Join-Path $BackupRoot $Timestamp

Write-Host "`n[1/4] Build Kontrolu Basliyor..." -ForegroundColor Cyan
Set-Location $ProjectRoot
try {
    npm run build
    Write-Host "Build basarili! Kod temiz." -ForegroundColor Green
} catch {
    Write-Host "Build HATASI! Yayin durduruldu. Lutfen TypeScript hatalarini duzeltin." -ForegroundColor Red
    exit 1
}

Write-Host "`n[2/4] Yerel Yedek Aliniyor..." -ForegroundColor Cyan
if (!(Test-Path $BackupRoot)) { New-Item -ItemType Directory -Path $BackupRoot }
New-Item -ItemType Directory -Path $CurrentBackupDir

try {
    Copy-Item -Path "src" -Destination (Join-Path $CurrentBackupDir "src") -Recurse -Force
    Copy-Item -Path "scripts" -Destination (Join-Path $CurrentBackupDir "scripts") -Recurse -Force
    Copy-Item -Path "package.json", "vite.config.ts", "index.html", "tsconfig.json" -Destination $CurrentBackupDir -Force
    
    # Yedekleme Bilgisi Yaz
    $Info = "Yedekleme Tarihi: $Timestamp`nDurum: Build Sonrasi Kararli`nVercel Deploy Oncesi Alinmistir."
    $Info | Out-File (Join-Path $CurrentBackupDir "BACKUP_INFO.txt")
    
    Write-Host "Yedekleme tamamlandi: $CurrentBackupDir" -ForegroundColor Green
} catch {
    Write-Host "Yedekleme sirasinda bir hata olustu!" -ForegroundColor Yellow
}

Write-Host "`n[3/4] Vercel Deployment Basliyor..." -ForegroundColor Cyan
try {
    npx vercel deploy --prod --yes
    Write-Host "Vercel yayini basariyla tamamlandi!" -ForegroundColor Green
} catch {
    Write-Host "Vercel yayini basarisiz oldu!" -ForegroundColor Red
}

Write-Host "`n[4/4] Protokol basariyla tamamlandi!" -ForegroundColor Magenta
Write-Host "--------------------------------------------------"
Write-Host "Hatirlatma: Her zaman bu scripti kullanarak yayina cikin."
Write-Host "--------------------------------------------------`n"
