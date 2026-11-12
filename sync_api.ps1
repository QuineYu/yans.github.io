param(
    [Parameter(Position=0)]
    [string]$Cipher = ""
)

# 设置控制台输出编码为 UTF-8
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8

Write-Host "==========================================================" -ForegroundColor Cyan
Write-Host "       🌟 星彩 Live2D - 一键同步 API 密文到 GitHub 🌟       " -ForegroundColor Cyan
Write-Host "==========================================================" -ForegroundColor Cyan
Write-Host ""

$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$targetFile = Join-Path $scriptDir "blogs\live2d\xingcai_chat.html"

if (-not (Test-Path $targetFile)) {
    Write-Host "❌ 未找到目标文件: $targetFile" -ForegroundColor Red
    Write-Host "请确保脚本位于项目根目录下。" -ForegroundColor Red
    exit 1
}

# 检查是否通过参数传入密文
if (-not $Cipher) {
    # 尝试从剪贴板读取密文
    $clipText = ""
    try {
        $clipText = (Get-Clipboard -Raw 2>$null)
        if ($clipText) { $clipText = $clipText.Trim() }
    } catch {}

    $isFromClip = $false
    if ($clipText -and $clipText.Length -gt 20) {
        try {
            $decoded = [System.Text.Encoding]::UTF8.GetString([System.Convert]::FromBase64String($clipText))
            if ($decoded -match '"salt"' -and $decoded -match '"iv"') {
                $isFromClip = $true
            }
        } catch {}
    }

    if ($isFromClip) {
        $preview = $clipText.Substring(0, [Math]::Min(35, $clipText.Length)) + "..."
        Write-Host "📋 检测到剪贴板中已复制的 AES-256 密文：" -ForegroundColor Green
        Write-Host "   $preview" -ForegroundColor Gray
        Write-Host ""
        $resp = Read-Host "👉 直接使用剪贴板中的密文？([Y]/n，按回车默认使用)"
        if ($resp -eq "" -or $resp -match '^[Yy]') {
            $Cipher = $clipText
        }
    }

    if (-not $Cipher) {
        Write-Host "👉 请粘贴从网页设置中复制的 AES-256 密文 (右键即可粘贴):" -ForegroundColor Yellow
        $Cipher = (Read-Host).Trim()
    }
}

if (-not $cipher) {
    Write-Host ""
    Write-Host "❌ 密文不能为空，操作已取消。" -ForegroundColor Red
    exit 1
}

# 校验密文有效性
try {
    $decoded = [System.Text.Encoding]::UTF8.GetString([System.Convert]::FromBase64String($cipher))
    if (-not ($decoded -match '"salt"' -and $decoded -match '"iv"')) {
        Write-Host "⚠️ 警告：输入的字符串看起来可能不是网页生成的标准 AES 密文，但仍将尝试写入。" -ForegroundColor Yellow
    }
} catch {
    Write-Host "❌ 密文格式错误（非有效 Base64 字符串），请确认复制的是完整密文。" -ForegroundColor Red
    exit 1
}

Write-Host ""
Write-Host "📝 正在写入 blogs/live2d/xingcai_chat.html ..." -ForegroundColor Cyan

$content = [System.IO.File]::ReadAllText($targetFile, [System.Text.Encoding]::UTF8)
$pattern = '(?m)^\s*window\.REPO_ENCRYPTED_API\s*=\s*["''].*?["''];'

if (-not [System.Text.RegularExpressions.Regex]::IsMatch($content, $pattern)) {
    Write-Host "❌ 未能在文件中匹配到 window.REPO_ENCRYPTED_API 定义！" -ForegroundColor Red
    exit 1
}

$replacement = "        window.REPO_ENCRYPTED_API = `"$cipher`";"
$newContent = [System.Text.RegularExpressions.Regex]::Replace($content, $pattern, $replacement, 1)

$utf8NoBom = New-Object System.Text.UTF8Encoding($false)
[System.IO.File]::WriteAllText($targetFile, $newContent, $utf8NoBom)
Write-Host "✅ 密文已成功写入源码 (blogs/live2d/xingcai_chat.html)！" -ForegroundColor Green

Write-Host ""
Write-Host "🚀 正在自动执行 Git 提交并推送到 GitHub..." -ForegroundColor Cyan
Set-Location $scriptDir

git add "blogs/live2d/xingcai_chat.html"
$status = git status --porcelain "blogs/live2d/xingcai_chat.html"
if (-not $status) {
    Write-Host "ℹ️ 密文内容与仓库当前版本完全一致，无需重复提交。" -ForegroundColor Yellow
    exit 0
}

git commit -m "chore: update encrypted API payload for multi-device sync"
if ($LASTEXITCODE -ne 0) {
    Write-Host "❌ Git commit 失败，请检查 Git 配置。" -ForegroundColor Red
    exit 1
}

Write-Host "📤 正在推送至 GitHub 远端仓库..." -ForegroundColor Cyan
git push origin main
if ($LASTEXITCODE -eq 0) {
    Write-Host ""
    Write-Host "==========================================================" -ForegroundColor Green
    Write-Host "  🎉 恭喜！密文已成功推送到 GitHub 仓库！" -ForegroundColor Green
    Write-Host "  现在你在手机、平板或任何新设备上打开网站：" -ForegroundColor Green
    Write-Host "  无需输入 API 地址，只需输入管理密码即可解锁使用！" -ForegroundColor Green
    Write-Host "==========================================================" -ForegroundColor Green
} else {
    Write-Host ""
    Write-Host "⚠️ git push 遇到网络波动或冲突，请检查网络或重新运行本脚本。" -ForegroundColor Yellow
    exit 1
}
