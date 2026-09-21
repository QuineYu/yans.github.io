/**
 * 星彩 (Xingcai) Live2D AI 对话与动作控制引擎
 * 提供：
 * 1. 实时 Live2D 参数动画驱动 (点头/摇头/歪头/害羞/眨眼/微笑/思考/惊讶/说话口型/换衣服)
 * 2. 本地开源大模型 (Ollama / LM Studio / vLLM 等 OpenAI 兼容格式) 实时流式通信
 * 3. 动作标签解析器 (在 LLM 输出中提取 [动作] 并实时触发动画)
 * 4. 离线/演示模式智能响应回退机制
 */

class Live2DMotionEngine {
    constructor() {
        this.paramIndices = null;
        this.activeActions = [];
        this.isSpeaking = false;
        this.speakingTimer = 0;
        this.appModel = null;
        this.modelWrapper = null;

        // 外观参数状态
        this.jacketVisible = true; // Param2: 0 (着装), -1 (脱外套)
        this.skirt1Visible = true; // Param
        this.skirt2Visible = false; // Param3

        // 持续微表情
        this.currentBlush = 0;
        this.targetBlush = 0;
        this.currentSmile = 0;
        this.targetSmile = 0;

        // 模型位置微调（默认居中）
        this.modelYOffset = 0.0;
        this.modelScale = 1.0;
    }

    /**
     * 初始化参数名称到索引映射表
     */
    initParams(modelWrapper) {
        if (this.paramIndices) return;
        this.paramIndices = {};
        const ids = modelWrapper._model.parameters.ids;
        for (let i = 0; i < ids.length; i++) {
            this.paramIndices[ids[i]] = i;
        }
        console.log('[Live2DMotionEngine] 成功映射 Live2D 参数, 共 ' + ids.length + ' 个参数');
    }

    getParamIndex(name) {
        if (!this.paramIndices) return -1;
        const idx = this.paramIndices[name];
        return idx !== undefined ? idx : -1;
    }

    setParam(values, name, val) {
        const idx = this.getParamIndex(name);
        if (idx >= 0) {
            values[idx] = val;
        }
    }

    addParam(values, name, delta) {
        const idx = this.getParamIndex(name);
        if (idx >= 0) {
            values[idx] += delta;
        }
    }

    getParam(values, name) {
        const idx = this.getParamIndex(name);
        return idx >= 0 ? values[idx] : 0;
    }

    /**
     * 每帧在 model.update() 之前被调用
     */
    update(appModel, modelWrapper, dt) {
        this.appModel = appModel;
        this.modelWrapper = modelWrapper;
        this.initParams(modelWrapper);

        const values = modelWrapper._parameterValues;
        if (!values) return;

        // 1. 首次加载时平移微调模型纵向居中位置，避免顶部蝴蝶结贴顶
        if (!this.layoutAdjusted && appModel && appModel._modelMatrix) {
            appModel._modelMatrix.translateY(-0.06);
            this.layoutAdjusted = true;
        }

        // 2. 更新基础常驻微表情平滑过渡 (脸红/微笑)
        const blushSpeed = 3.0 * dt;
        if (Math.abs(this.currentBlush - this.targetBlush) > 0.01) {
            this.currentBlush += (this.targetBlush - this.currentBlush) * blushSpeed;
        } else {
            this.currentBlush = this.targetBlush;
        }
        if (this.currentBlush > 0.01) {
            this.setParam(values, 'ParamCheek', Math.min(1.0, this.currentBlush));
        }

        const smileSpeed = 4.0 * dt;
        if (Math.abs(this.currentSmile - this.targetSmile) > 0.01) {
            this.currentSmile += (this.targetSmile - this.currentSmile) * smileSpeed;
        } else {
            this.currentSmile = this.targetSmile;
        }
        if (this.currentSmile > 0.01) {
            this.setParam(values, 'ParamEyeLSmile', Math.min(1.0, this.currentSmile));
            this.setParam(values, 'ParamEyeRSmile', Math.min(1.0, this.currentSmile));
            this.setParam(values, 'ParamMouthForm', Math.min(1.0, this.currentSmile));
        }

        // 3. 说话对口型 (自然多频正弦波振荡)
        if (this.isSpeaking) {
            this.speakingTimer += dt;
            // 组合多频波形模拟人类说话节奏
            const s1 = Math.sin(this.speakingTimer * 14) * 0.35;
            const s2 = Math.sin(this.speakingTimer * 22) * 0.2;
            const s3 = Math.sin(this.speakingTimer * 6.5) * 0.15;
            const openAmount = Math.max(0.05, Math.min(0.85, s1 + s2 + s3 + 0.35));
            this.setParam(values, 'ParamMouthOpenY', openAmount);
            this.setParam(values, 'ParamMouthForm', 0.4);
        }

        // 4. 执行动态动作队列 (点头, 摇头, 歪头, 眨眼, 思考等)
        for (let i = this.activeActions.length - 1; i >= 0; i--) {
            const act = this.activeActions[i];
            const alive = act.update(dt, this, values);
            if (!alive) {
                if (act.onFinish) act.onFinish(this);
                this.activeActions.splice(i, 1);
            }
        }
    }

    // ==========================================
    // 动作指令库 (Procedural Animations)
    // ==========================================

    /**
     * 点头动作
     */
    nod(intensity = 1.0, duration = 1.2) {
        this.activeActions.push({
            type: 'nod',
            elapsed: 0,
            duration: duration,
            update(dt, engine, values) {
                this.elapsed += dt;
                const progress = this.elapsed / this.duration;
                if (progress >= 1.0) return false;
                const decay = Math.pow(1.0 - progress, 1.2);
                // 2次点头波形
                const pitch = Math.sin(progress * Math.PI * 4) * 16 * intensity * decay;
                engine.addParam(values, 'ParamAngleY', -pitch);
                return true;
            }
        });
    }

    /**
     * 摇头动作
     */
    shake(intensity = 1.0, duration = 1.4) {
        this.activeActions.push({
            type: 'shake',
            elapsed: 0,
            duration: duration,
            update(dt, engine, values) {
                this.elapsed += dt;
                const progress = this.elapsed / this.duration;
                if (progress >= 1.0) return false;
                const decay = Math.pow(1.0 - progress, 1.2);
                // 2次左右摇头波形
                const yaw = Math.sin(progress * Math.PI * 4) * 18 * intensity * decay;
                engine.addParam(values, 'ParamAngleX', yaw);
                return true;
            }
        });
    }

    /**
     * 歪头动作 (疑惑/卖萌)
     */
    tilt(intensity = 1.0, duration = 2.0) {
        this.activeActions.push({
            type: 'tilt',
            elapsed: 0,
            duration: duration,
            update(dt, engine, values) {
                this.elapsed += dt;
                const progress = this.elapsed / this.duration;
                if (progress >= 1.0) return false;
                // 抛物线平滑倾斜
                const roll = Math.sin(progress * Math.PI) * 16 * intensity;
                engine.addParam(values, 'ParamAngleZ', roll);
                return true;
            }
        });
    }

    /**
     * 害羞/脸红动作
     */
    blush(duration = 3.5) {
        this.targetBlush = 1.0;
        this.activeActions.push({
            type: 'blush',
            elapsed: 0,
            duration: duration,
            update(dt, engine, values) {
                this.elapsed += dt;
                const progress = this.elapsed / this.duration;
                if (progress >= 1.0) return false;
                const shyCurve = Math.sin(progress * Math.PI);
                // 羞怯低头与下视
                engine.addParam(values, 'ParamAngleY', -8 * shyCurve);
                engine.setParam(values, 'ParamEyeBallY', -0.35 * shyCurve);
                return true;
            },
            onFinish(engine) {
                engine.targetBlush = 0.0;
            }
        });
    }

    /**
     * 眨眼/眨单眼 (Wink)
     */
    wink(duration = 0.8) {
        this.activeActions.push({
            type: 'wink',
            elapsed: 0,
            duration: duration,
            update(dt, engine, values) {
                this.elapsed += dt;
                const progress = this.elapsed / this.duration;
                if (progress >= 1.0) return false;
                // 右眼闭合, 左眼保持睁开
                const closeAmount = Math.sin(progress * Math.PI);
                const eyeROpen = Math.max(0, 1.0 - closeAmount * 1.3);
                engine.setParam(values, 'ParamEyeROpen', eyeROpen);
                engine.setParam(values, 'ParamEyeRSmile', closeAmount);
                engine.addParam(values, 'ParamAngleZ', closeAmount * 8);
                return true;
            }
        });
    }

    /**
     * 微笑/开心动作
     */
    smile(duration = 2.5) {
        this.targetSmile = 1.0;
        this.activeActions.push({
            type: 'smile',
            elapsed: 0,
            duration: duration,
            update(dt, engine, values) {
                this.elapsed += dt;
                const progress = this.elapsed / this.duration;
                if (progress >= 1.0) return false;
                const curve = Math.sin(progress * Math.PI);
                // 开心微跳
                engine.addParam(values, 'ParamAngleY', curve * 6);
                return true;
            },
            onFinish(engine) {
                engine.targetSmile = 0.0;
            }
        });
    }

    /**
     * 思考动作 (眼球右上漂移、头部轻偏)
     */
    think(duration = 3.0) {
        this.activeActions.push({
            type: 'think',
            elapsed: 0,
            duration: duration,
            update(dt, engine, values) {
                this.elapsed += dt;
                const progress = this.elapsed / this.duration;
                if (progress >= 1.0) return false;
                const curve = Math.sin(progress * Math.PI);
                engine.setParam(values, 'ParamEyeBallX', 0.6 * curve);
                engine.setParam(values, 'ParamEyeBallY', 0.65 * curve);
                engine.addParam(values, 'ParamAngleZ', 10 * curve);
                engine.addParam(values, 'ParamAngleY', 5 * curve);
                return true;
            }
        });
    }

    /**
     * 惊讶动作 (睁大双眼、嘴巴微张)
     */
    surprise(duration = 1.8) {
        this.activeActions.push({
            type: 'surprise',
            elapsed: 0,
            duration: duration,
            update(dt, engine, values) {
                this.elapsed += dt;
                const progress = this.elapsed / this.duration;
                if (progress >= 1.0) return false;
                const curve = Math.sin(progress * Math.PI);
                engine.setParam(values, 'ParamEyeLOpen', 1.0 + 0.25 * curve);
                engine.setParam(values, 'ParamEyeROpen', 1.0 + 0.25 * curve);
                engine.addParam(values, 'ParamBrowLY', 0.6 * curve);
                engine.addParam(values, 'ParamBrowRY', 0.6 * curve);
                engine.setParam(values, 'ParamMouthOpenY', 0.55 * curve);
                return true;
            }
        });
    }

    /**
     * 说话对口型状态设置
     */
    setSpeaking(speaking) {
        this.isSpeaking = speaking;
        if (!speaking) {
            this.speakingTimer = 0;
            if (this.modelWrapper && this.modelWrapper._parameterValues) {
                this.setParam(this.modelWrapper._parameterValues, 'ParamMouthOpenY', 0);
            }
        }
    }

    /**
     * 切换上衣/外套显示
     */
    toggleJacket() {
        if (this.appModel) {
            this.jacketActive = !this.jacketActive;
            if (this.jacketActive) {
                this.appModel.setExpression('jacket');
            } else {
                this.appModel.setExpression('');
            }
            return this.jacketActive;
        }
        return false;
    }

    /**
     * 切换裙子 1
     */
    toggleSkirt1() {
        if (this.appModel) {
            this.skirt1Active = !this.skirt1Active;
            if (this.skirt1Active) {
                this.appModel.setExpression('skirt1');
            } else {
                this.appModel.setExpression('');
            }
            return this.skirt1Active;
        }
        return false;
    }

    /**
     * 切换裙子 2
     */
    toggleSkirt2() {
        if (this.appModel) {
            this.skirt2Active = !this.skirt2Active;
            if (this.skirt2Active) {
                this.appModel.setExpression('skirt2');
            } else {
                this.appModel.setExpression('');
            }
            return this.skirt2Active;
        }
        return false;
    }

    /**
     * 根据字符串动作名称分发触发
     */
    triggerAction(name) {
        const clean = name.replace(/[\[\]]/g, '').trim().toLowerCase();
        console.log('[Live2DMotionEngine] 触发动作: ' + clean);
        switch (clean) {
            case '点头':
            case 'nod':
                this.nod();
                break;
            case '摇头':
            case 'shake':
                this.shake();
                break;
            case '歪头':
            case 'tilt':
                this.tilt();
                break;
            case '害羞':
            case '脸红':
            case 'blush':
                this.blush();
                break;
            case '眨眼':
            case '卖萌':
            case 'wink':
                this.wink();
                break;
            case '微笑':
            case '开心':
            case 'smile':
                this.smile();
                break;
            case '思考':
            case '沉思':
            case 'think':
                this.think();
                break;
            case '惊讶':
            case '吃惊':
            case 'surprise':
                this.surprise();
                break;
            case '换衣服':
            case '外套':
            case '脱外套':
            case '穿外套':
            case 'jacket':
                this.toggleJacket();
                this.wink();
                break;
            case '裙子1':
            case 'skirt1':
                this.toggleSkirt1();
                break;
            case '裙子2':
            case 'skirt2':
                this.toggleSkirt2();
                break;
            default:
                console.warn('[Live2DMotionEngine] 未知动作标签: ' + clean);
        }
    }
}

/**
 * 本地大模型客户端 (兼容 Ollama, LM Studio, vLLM 等 OpenAI 规范接口)
 */
class LocalLLMClient {
    constructor() {
        this.loadSettings();
    }

    loadSettings() {
        this.baseUrl = localStorage.getItem('llm_base_url') || 'http://localhost:11434/v1';
        this.modelName = localStorage.getItem('llm_model_name') || 'qwen2.5:7b';
        this.apiKey = localStorage.getItem('llm_api_key') || '';
        this.temperature = parseFloat(localStorage.getItem('llm_temperature') || '0.7');
        this.systemPrompt = localStorage.getItem('llm_system_prompt') || 
`你是“星彩”，一位活泼可爱、聪明温柔的AI助手。你正在一个全屏Live2D互动网页中与主人实时交流。
在回答时，请根据你的情绪和语境，在适当的位置自然地插入以下动作标签（每次回答使用1~3个即可）：
- [点头]：表示认同、赞同、理解
- [摇头]：表示否定、无奈、不赞成
- [歪头]：表示好奇、疑惑、可爱倾听
- [害羞]：表示被夸奖、不好意思、羞怯
- [眨眼]：表示调皮、卖萌、眨单眼
- [微笑]：表示高兴、开心、亲切
- [思考]：表示认真斟酌、寻找答案
- [惊讶]：表示出乎意料、惊叹
- [换衣服]：切换外套穿脱
请用生动、亲切、富有少女感的语气回答主人，回答简明自然。`;
    }

    saveSettings(config) {
        if (config.baseUrl !== undefined) {
            this.baseUrl = config.baseUrl.replace(/\/+$/, '');
            localStorage.setItem('llm_base_url', this.baseUrl);
        }
        if (config.modelName !== undefined) {
            this.modelName = config.modelName;
            localStorage.setItem('llm_model_name', this.modelName);
        }
        if (config.apiKey !== undefined) {
            this.apiKey = config.apiKey;
            localStorage.setItem('llm_api_key', this.apiKey);
        }
        if (config.temperature !== undefined) {
            this.temperature = config.temperature;
            localStorage.setItem('llm_temperature', this.temperature);
        }
        if (config.systemPrompt !== undefined) {
            this.systemPrompt = config.systemPrompt;
            localStorage.setItem('llm_system_prompt', this.systemPrompt);
        }
    }

    /**
     * 检测本地模型健康状态
     */
    async checkHealth() {
        try {
            const controller = new AbortController();
            const timeoutId = setTimeout(() => controller.abort(), 2000);
            const res = await fetch(`${this.baseUrl}/models`, {
                method: 'GET',
                headers: this.apiKey ? { 'Authorization': `Bearer ${this.apiKey}` } : {},
                signal: controller.signal
            });
            clearTimeout(timeoutId);
            if (res.ok) {
                const data = await res.json();
                return { ok: true, models: data.data || [] };
            }
            return { ok: false, error: 'HTTP ' + res.status };
        } catch (err) {
            return { ok: false, error: err.message };
        }
    }

    /**
     * 发送聊天请求 (流式 SSE)
     */
    async chatStream(messages, onChunk, onDone, onError) {
        const fullMessages = [
            { role: 'system', content: this.systemPrompt },
            ...messages
        ];

        const payload = {
            model: this.modelName,
            messages: fullMessages,
            temperature: this.temperature,
            stream: true
        };

        const headers = { 'Content-Type': 'application/json' };
        if (this.apiKey) {
            headers['Authorization'] = `Bearer ${this.apiKey}`;
        }

        try {
            const res = await fetch(`${this.baseUrl}/chat/completions`, {
                method: 'POST',
                headers: headers,
                body: JSON.stringify(payload)
            });

            if (!res.ok) {
                throw new Error(`服务响应错误 (${res.status} ${res.statusText})`);
            }

            const reader = res.body.getReader();
            const decoder = new TextDecoder('utf-8');
            let buffer = '';

            while (true) {
                const { done, value } = await reader.read();
                if (done) break;
                buffer += decoder.decode(value, { stream: true });
                const lines = buffer.split('\n');
                buffer = lines.pop(); // 保留最后一个未完成行

                for (const line of lines) {
                    const trimmed = line.trim();
                    if (!trimmed || !trimmed.startsWith('data:')) continue;
                    const jsonStr = trimmed.replace(/^data:\s*/, '');
                    if (jsonStr === '[DONE]') {
                        onDone();
                        return;
                    }
                    try {
                        const parsed = JSON.parse(jsonStr);
                        const delta = parsed.choices?.[0]?.delta?.content;
                        if (delta) {
                            onChunk(delta);
                        }
                    } catch (e) {
                        // 忽略格式异常行
                    }
                }
            }
            onDone();
        } catch (err) {
            onError(err);
        }
    }

    /**
     * 智能演示模式回退响应 (当本地大模型未开启时使用)
     */
    getMockResponse(userText) {
        const lower = userText.toLowerCase();

        if (lower.includes('你好') || lower.includes('hi') || lower.includes('hello') || lower.includes('在吗')) {
            return '[微笑] 主人好呀！星彩一直在等您呢。[眨眼] 很高兴见到你，今天有什么想和我一起交流的吗？';
        }
        if (lower.includes('漂亮') || lower.includes('可爱') || lower.includes('夸') || lower.includes('喜欢你')) {
            return '[害羞] 哎呀……主人突然这么夸我，人家会不好意思的啦！[脸红] 不过……心里真的很开心呢，谢谢主人！[微笑]';
        }
        if (lower.includes('不理') || lower.includes('讨厌') || lower.includes('笨') || lower.includes('不行')) {
            return '[摇头] 怎么会呢！星彩绝对没有这样想哦！[歪头] 无论发生什么，我都会一直陪伴在主人身边的~';
        }
        if (lower.includes('换') || lower.includes('衣服') || lower.includes('外套') || lower.includes('脱') || lower.includes('穿')) {
            return '[眨眼] 收到！马上为主人换新造型哦~ [换衣服] 怎么样，主人更喜欢星彩哪一种风格呢？[微笑]';
        }
        if (lower.includes('眨') || lower.includes('卖萌')) {
            return '[眨眼] 这样卖萌可以吗？[微笑] 只要主人开心，星彩怎么样都可以哦~';
        }
        if (lower.includes('为什么') || lower.includes('哲学') || lower.includes('怎么看') || lower.includes('考')) {
            return '[思考] 这是一个非常深刻的问题呢……容星彩认真斟酌一下。[点头] 我认为，在探索未知的道路上，保持热爱与好奇本身就是最宝贵的智慧。';
        }
        if (lower.includes('哇') || lower.includes('厉害') || lower.includes('真的吗')) {
            return '[惊讶] 哇！真的吗？！太不可思议了！[微笑] 主人快详细跟我讲讲！[点头]';
        }

        // 默认回显并带动作
        const defaultPool = [
            '[点头] 我明白主人的意思啦！[微笑] 虽然本地模型还在部署调优中，但星彩的动作系统已经完全准备就绪了哦~ [眨眼] 您可以在右上方【动作调试】中测试我的动作，也可以在【设置】中绑定您的本地模型！',
            '[歪头] 收到主人的消息啦！[微笑] 星彩随时都在这里陪伴您学习和工作哦，有什么我可以帮忙的吗？[眨眼]',
            '[思考] 主人的提议很有意思呢！[点头] 让我们一起继续探索吧，星彩会一直认真倾听的！[微笑]'
        ];
        return defaultPool[Math.floor(Math.random() * defaultPool.length)];
    }
}

// 导出单例到全局
window.live2dMotionEngine = new Live2DMotionEngine();
window.localLLMClient = new LocalLLMClient();

// 注册 Live2D 每一帧的回调 Hook
window.onLive2DUpdate = function(appModel, modelWrapper, dt) {
    if (window.live2dMotionEngine) {
        window.live2dMotionEngine.update(appModel, modelWrapper, dt);
    }
};
