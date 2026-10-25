import asyncio
from fastapi import FastAPI, Query, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse
import edge_tts

app = FastAPI(title="Xingcai Edge-TTS Server", version="1.0.0")

# 跨域设置，允许前端页面无缝访问
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# 默认设置：深沉慵懒的“晓晓”，-8Hz 营造从容倦怠的千年魔女感
DEFAULT_VOICE = "zh-CN-XiaoxiaoNeural"
DEFAULT_PITCH = "-8Hz"
DEFAULT_RATE = "-5%"
DEFAULT_VOLUME = "-15%"

@app.get("/")
@app.get("/health")
async def health_check():
    return {
        "status": "online",
        "service": "Xingcai Edge-TTS Service",
        "default_voice": DEFAULT_VOICE,
        "default_pitch": DEFAULT_PITCH
    }

@app.get("/voices")
async def list_voices():
    """获取所有可用的中文神经语音列表"""
    try:
        voices = await edge_tts.list_voices()
        chinese_voices = [
            {
                "Name": v["Name"],
                "ShortName": v["ShortName"],
                "Gender": v["Gender"],
                "Locale": v["Locale"]
            }
            for v in voices if "zh-" in v["Locale"]
        ]
        return {"count": len(chinese_voices), "voices": chinese_voices}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@app.get("/tts")
async def text_to_speech(
    text: str = Query(..., description="要合成的语音文本内容"),
    voice: str = Query(DEFAULT_VOICE, description="音色名称"),
    pitch: str = Query(DEFAULT_PITCH, description="音调调整 (如 +4Hz, +10%, -5Hz)"),
    rate: str = Query(DEFAULT_RATE, description="语速调整 (如 +0%, +10%, -10%)"),
    volume: str = Query(DEFAULT_VOLUME, description="音量调整 (如 +0%, +20%)")
):
    """
    流式生成 MP3 音频并返回
    """
    clean_text = text.strip()
    if not clean_text:
        raise HTTPException(status_code=400, detail="Text cannot be empty")

    try:
        communicate = edge_tts.Communicate(
            text=clean_text,
            voice=voice,
            pitch=pitch,
            rate=rate,
            volume=volume
        )

        async def audio_generator():
            async for chunk in communicate.stream():
                if chunk["type"] == "audio":
                    yield chunk["data"]

        return StreamingResponse(
            audio_generator(),
            media_type="audio/mpeg",
            headers={
                "Cache-Control": "no-cache",
                "X-Accel-Buffering": "no"
            }
        )
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"TTS synthesis error: {str(e)}")

if __name__ == "__main__":
    import uvicorn
    print("[Xingcai Edge-TTS] 启动中... 访问 http://127.0.0.1:8000")
    uvicorn.run(app, host="127.0.0.1", port=8000, log_level="info")
