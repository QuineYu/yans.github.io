import sys
import os
import re
import subprocess
import base64
import json

script_dir = os.path.dirname(os.path.abspath(__file__))
target_file = os.path.join(script_dir, "blogs", "live2d", "xingcai_chat.html")

if not os.path.exists(target_file):
    print(f"❌ 未找到文件: {target_file}")
    sys.exit(1)

cipher = sys.argv[1].strip() if len(sys.argv) > 1 else ""

if not cipher:
    print("=" * 55)
    print("🌟 星彩 Live2D - API 密文手动同步工具 🌟")
    print("=" * 55)
    print("👉 请粘贴网页生成的 AES-256 密文（右键粘贴后按回车）:")
    try:
        cipher = input().strip()
    except (EOFError, KeyboardInterrupt):
        print("\n操作已取消。")
        sys.exit(0)

if not cipher:
    print("❌ 密文不能为空！")
    sys.exit(1)

# 校验密文有效性
try:
    decoded = base64.b64decode(cipher).decode("utf-8")
    data = json.loads(decoded)
    if "salt" not in data or "iv" not in data:
        print("⚠️ 提示：密文字符串特征不匹配标准 AES 结构，但仍将尝试写入。")
except Exception:
    pass

# 读取并替换 HTML 中的 window.REPO_ENCRYPTED_API
with open(target_file, "r", encoding="utf-8") as f:
    content = f.read()

pattern = r'(?m)^\s*window\.REPO_ENCRYPTED_API\s*=\s*["\'].*?["\'];'
replacement = f'        window.REPO_ENCRYPTED_API = "{cipher}";'

if not re.search(pattern, content):
    print("❌ 未能在 blogs/live2d/xingcai_chat.html 中找到 window.REPO_ENCRYPTED_API")
    sys.exit(1)

new_content = re.sub(pattern, replacement, content, count=1)
with open(target_file, "w", encoding="utf-8") as f:
    f.write(new_content)

print("✅ 密文已写入 blogs/live2d/xingcai_chat.html！")

# 自动 Git 提交与推送
print("\n🚀 正在提交并推送到 GitHub...")
subprocess.run(["git", "add", "blogs/live2d/xingcai_chat.html"], cwd=script_dir)
commit_res = subprocess.run(["git", "commit", "-m", "chore: update encrypted API payload for multi-device sync"], cwd=script_dir)

if commit_res.returncode != 0:
    print("ℹ️ 密文内容无变动，未产生新的 Git 提交。")
else:
    print("📤 正在推送到 GitHub 远程仓库...")
    push_res = subprocess.run(["git", "push", "origin", "main"], cwd=script_dir)
    if push_res.returncode == 0:
        print("\n" + "=" * 55)
        print("🎉 恭喜！密文已成功推送到 GitHub 远程仓库！")
        print("现在你在其他设备打开网站，输入管理密码即可解锁使用！")
        print("=" * 55)
    else:
        print("\n⚠️ git push 遇到网络波动，请检查网络或稍后手动运行 git push origin main")
