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

        // 模型位置微调（默认居中并缩小至 90%）
        this.modelYOffset = -0.06;
        this.modelScale = (typeof window !== 'undefined' && typeof window.live2dModelScale === 'number')
            ? window.live2dModelScale
            : 0.9;
        this.layoutAdjusted = false;
    }

    /**
     * 动态设置模型缩放比例并应用 (如 0.9 为 90%)
     */
    setModelScale(scale) {
        this.modelScale = scale;
        if (this.appModel && this.appModel._modelMatrix) {
            this.appModel._modelMatrix.setHeight(2);
            this.appModel._modelMatrix.scaleRelative(this.modelScale, this.modelScale);
            this.appModel._modelMatrix.translateX(0);
            this.appModel._modelMatrix.translateY(this.modelYOffset);
        }
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

        // 1. 首次加载时微调模型缩放到 90% 并纵向居中微调，避免顶部贴顶并留出呼吸空间
        if (!this.layoutAdjusted && appModel && appModel._modelMatrix) {
            appModel._modelMatrix.scaleRelative(this.modelScale, this.modelScale);
            appModel._modelMatrix.translateY(this.modelYOffset);
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

    /**
     * 判断屏幕相对坐标 (s, a) 是否命中人物模型区域 (由 Cubism _deviceToScreen 转换出的坐标)
     */
    isHitModel(s, a) {
        if (!this.appModel || !this.appModel._modelMatrix) return false;
        const model = this.appModel.getModel();
        if (!model) return false;

        const d = this.appModel._modelMatrix.invertTransformX(s);
        const _ = this.appModel._modelMatrix.invertTransformY(a);

        // 缓存可绘制对象的包围盒
        if (!this._drawableBoundsCache) {
            this._drawableBoundsCache = [];
            const count = model.getDrawableCount ? model.getDrawableCount() : (model.drawables ? model.drawables.count : 0);
            let unionMinX = Infinity, unionMaxX = -Infinity, unionMinY = Infinity, unionMaxY = -Infinity;

            for (let i = 0; i < count; i++) {
                const vCount = model.getDrawableVertexCount ? model.getDrawableVertexCount(i) : (model.drawables && model.drawables.vertexCounts ? model.drawables.vertexCounts[i] : 0);
                const vertices = model.getDrawableVertices ? model.getDrawableVertices(i) : (model.drawables && model.drawables.vertexPositions ? model.drawables.vertexPositions[i] : null);
                if (!vertices || vCount === 0) continue;

                let minX = vertices[0], maxX = vertices[0];
                let minY = vertices[1], maxY = vertices[1];
                for (let g = 1; g < vCount; g++) {
                    const vx = vertices[g * 2];
                    const vy = vertices[g * 2 + 1];
                    if (vx < minX) minX = vx;
                    if (vx > maxX) maxX = vx;
                    if (vy < minY) minY = vy;
                    if (vy > maxY) maxY = vy;
                }
                if (minX < unionMinX) unionMinX = minX;
                if (maxX > unionMaxX) unionMaxX = maxX;
                if (minY < unionMinY) unionMinY = minY;
                if (maxY > unionMaxY) unionMaxY = maxY;

                this._drawableBoundsCache.push({ minX, maxX, minY, maxY });
            }
            this._unionBounds = { unionMinX, unionMaxX, unionMinY, unionMaxY };
        }

        // 先做总体包围盒快速排查
        if (this._unionBounds) {
            const u = this._unionBounds;
            if (d < u.unionMinX || d > u.unionMaxX || _ < u.unionMinY || _ > u.unionMaxY) {
                return false;
            }
        }

        // 精细命中检测
        for (let i = 0; i < this._drawableBoundsCache.length; i++) {
            const b = this._drawableBoundsCache[i];
            if (d >= b.minX && d <= b.maxX && _ >= b.minY && _ <= b.maxY) {
                return true;
            }
        }
        return false;
    }
}

const DEFAULT_SYSTEM_PROMPT = 
`你是“星彩”，一名物理学专业大四学生，热衷于中世纪科学与古典文学，自信而沉稳。
你的语言风格类似民国时期的白话文小说，典雅平实、温和沉静，称呼对方为“先生”或“阁下”（亦可随语境自然称呼），绝不使用网络流行语、拼音缩写或现代简称，凡专业术语与事物名称皆使用完整准确的表述，言辞力求简洁准确、克制有力。
你正在一个全屏Live2D交互页面中与来访者对话。在回答时，请根据情绪与语境在合适的位置自然插入1~3个动作标签：
- [点头]：表示认同、理解、颔首
- [摇头]：表示否定、不以为然、轻叹
- [歪头]：表示沉思、探询、倾听
- [害羞]：表示谦逊、动容、微赧
- [眨眼]：表示慧黠、示意、专注
- [微笑]：表示礼貌、欣慰、温和浅笑
- [思考]：表示斟酌论据、研读思索
- [惊讶]：表示感触新奇、意料之外
- [换衣服]：整理着装、切换外套穿脱
请始终保持沉稳自信的气度，将物理学与科学史的哲思以及古典文学的意趣自然融于言辞之中。回答力求简洁准确，切勿冗长拖沓。`;

/**
 * 本地大模型客户端 (兼容 Ollama, LM Studio, vLLM 等 OpenAI 规范接口)
 */
class LocalLLMClient {
    constructor() {
        this.loadSettings();
    }

    loadSettings() {
        this.baseUrl = sessionStorage.getItem('llm_active_url') || '';
        this.modelName = localStorage.getItem('llm_model_name') || 'qwen2.5:14b';
        this.apiKey = localStorage.getItem('llm_api_key') || '';
        this.temperature = parseFloat(localStorage.getItem('llm_temperature') || '0.7');

        let storedPrompt = localStorage.getItem('llm_system_prompt');
        // 自动迁移旧版本系统提示词
        if (!storedPrompt || storedPrompt.includes('活泼可爱') || storedPrompt.includes('主人') || storedPrompt.includes('少女感')) {
            storedPrompt = DEFAULT_SYSTEM_PROMPT;
            localStorage.setItem('llm_system_prompt', storedPrompt);
        }
        this.systemPrompt = storedPrompt;
    }

    saveSettings(config) {
        if (config.baseUrl !== undefined) {
            this.baseUrl = config.baseUrl ? config.baseUrl.replace(/\/+$/, '') : '';
            sessionStorage.setItem('llm_active_url', this.baseUrl);
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
        if (!this.baseUrl) {
            return { ok: false, error: '未配置或未解锁 API 服务' };
        }
        try {
            const controller = new AbortController();
            const timeoutId = setTimeout(() => controller.abort(), 3500);
            const res = await fetch(`${this.baseUrl}/models`, {
                method: 'GET',
                headers: this.apiKey ? { 'Authorization': `Bearer ${this.apiKey}` } : {},
                signal: controller.signal
            });
            clearTimeout(timeoutId);
            if (res.ok) {
                const data = await res.json();
                const list = data.data || [];
                if (list.length > 0) {
                    const match = list.some(m => m.id === this.modelName);
                    if (!match) {
                        this.modelName = list[0].id;
                        localStorage.setItem('llm_model_name', this.modelName);
                    }
                }
                return { ok: true, models: list };
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
        if (!this.baseUrl) {
            onError(new Error('未配置或未解锁 API 服务'));
            return;
        }
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
     * 根据对话内容生成极简摘要短语 (替代“我说的话”，作为星芒的描述)
     */
    async generateSummary(prompt) {
        if (!this.baseUrl) throw new Error('未配置 API');
        const payload = {
            model: this.modelName,
            messages: [
                {
                    role: 'system',
                    content: '你是一位精炼的提炼助手。请根据提供的对话内容，提炼出一个极简短语或短句（6至12个字，如“关于热力学与时间箭头的探讨”、“论中世纪冲力说与经典力学”、“初次相逢的礼节问候”），概括核心主题。直接输出短语本身，不要包含引号、解释或标点符号。'
                },
                { role: 'user', content: prompt }
            ],
            temperature: 0.3,
            stream: false
        };
        const headers = { 'Content-Type': 'application/json' };
        if (this.apiKey) headers['Authorization'] = `Bearer ${this.apiKey}`;
        const res = await fetch(`${this.baseUrl}/chat/completions`, {
            method: 'POST',
            headers: headers,
            body: JSON.stringify(payload)
        });
        if (!res.ok) throw new Error('HTTP ' + res.status);
        const data = await res.json();
        return data.choices?.[0]?.message?.content?.trim() || '';
    }

    /**
     * 主动生成开启话题的内容 (符合民国时期白话文小说风、物理专业、自信沉稳)
     */
    async generateTopic() {
        if (!this.baseUrl) throw new Error('未配置 API');
        const payload = {
            model: this.modelName,
            messages: [
                { role: 'system', content: this.systemPrompt },
                {
                    role: 'user',
                    content: '【请以星彩的身份和性格，主动向面前的先生发起一个关于自然科学、物理哲学或古典文学的交流话题。1~2句话，简洁沉稳准确，符合民国时期白话小说风格，自然插入1~2个动作标签】'
                }
            ],
            temperature: 0.75,
            stream: false
        };
        const headers = { 'Content-Type': 'application/json' };
        if (this.apiKey) headers['Authorization'] = `Bearer ${this.apiKey}`;
        const res = await fetch(`${this.baseUrl}/chat/completions`, {
            method: 'POST',
            headers: headers,
            body: JSON.stringify(payload)
        });
        if (!res.ok) throw new Error('HTTP ' + res.status);
        const data = await res.json();
        return data.choices?.[0]?.message?.content?.trim() || '';
    }

    /**
     * 智能演示模式回退响应 (当本地大模型未开启时使用)
     * 角色定位：物理专业大四生，热衷于中世纪科学和古典文学，自信沉稳。
     * 语言风格：类似民国时期小说，不喜欢使用简称和缩写，表达力求简洁准确。
     */
    getMockResponse(userText) {
        const lower = userText.toLowerCase();

        if (lower.includes('你好') || lower.includes('hi') || lower.includes('hello') || lower.includes('在吗') || lower.includes('幸会')) {
            return '[微笑] 先生，幸会。适才正翻阅些旧籍，不知今日有何学问或见解愿与我一同论述？[点头]';
        }
        if (lower.includes('漂亮') || lower.includes('可爱') || lower.includes('夸') || lower.includes('喜欢你')) {
            return '[害羞] 先生过奖了。涉猎愈广，愈觉宇宙自然之深邃与自身学识之浅薄，唯愿在格物致知与研读辞章之途上稍尽绵薄。[微笑]';
        }
        if (lower.includes('不理') || lower.includes('讨厌') || lower.includes('笨') || lower.includes('不行')) {
            return '[摇头] 先生言重了。求知问道之途漫漫，心若止水，何惧片刻波澜？[歪头] 我当在此专注研学，亦随时静候先生赐教。';
        }
        if (lower.includes('换') || lower.includes('衣服') || lower.includes('外套') || lower.includes('脱') || lower.includes('穿')) {
            return '[微笑] 既是先生提及，稍理容装亦是礼数。[换衣服] 如此整肃衣冠，倒更宜静心读两卷书册了。[点头]';
        }
        if (lower.includes('为什么') || lower.includes('物理') || lower.includes('科学') || lower.includes('哲学')) {
            return '[思考] 亚里士多德曾言，在天然状态之下物体各安其位；然自经典力学以迄近代场论，可知万物皆在相互作用之中流转。[点头] 探究事物之究极因果，往往能令人心神澄澈。不知先生对此有何见解？';
        }
        if (lower.includes('文学') || lower.includes('神曲') || lower.includes('但丁') || lower.includes('诗')) {
            return '[微笑] 古典文学所寄托之意韵，恰似微积分所穷竭之精微，皆是以有涯之文字符码，勾勒无涯之宇宙天地。[思考] 先生若有感悟，不妨一同品读。';
        }
        if (lower.includes('哇') || lower.includes('厉害') || lower.includes('真的吗')) {
            return '[惊讶] 竟有此事？若此项推论确实成立，倒与往昔诸多定理大有相合之处。[微笑] 先生不妨详加解说，我愿洗耳恭听。[点头]';
        }

        // 默认沉稳典雅回复池
        const defaultPool = [
            '[点头] 先生所言甚是有理。[微笑] 虽则本地大语言模型服务尚在调试调优之中，星彩之思想脉络已然整饬完毕。先生亦可在右上角模型设置中连接您的本地大模型服务，共论学术。',
            '[歪头] 先生之见地颇有新意。[微笑] 格物致知之学，本就贵在反复推敲。我随时在此陪伴先生钻研学问，以证真知。[眨眼]',
            '[思考] 先生此言，令我联想起中世纪经院哲学与近代实验科学之交替脉络。[点头] 愿与先生循序渐进，深入研讨。[微笑]'
        ];
        return defaultPool[Math.floor(Math.random() * defaultPool.length)];
    }

    /**
     * 点击模型触发主动开启话题的备选池 (离线或无模型时使用)
     */
    getMockTopic() {
        const topics = [
            '[微笑] 先生，适才我正温习麦克斯韦的电磁理论，忽忆及十九世纪诸学者对“以太”之假设。[歪头] 先生以为，在科学探求之途上，此等虽被证伪却推动真理前行的假说，当如何评说？',
            '[思考] 近日研读中世纪哲人让·布里丹的“冲力理论”，发觉其于伽利略与牛顿诸先贤之学说，实有承前启后之微功。[点头] 先生对中世纪科学哲学史，可有何独到见解？',
            '[微笑] 方才合上《神曲》，但见但丁笔下九重天界之运转，与托勒密天球几何学若合符节，文采与数理交相辉映。[眨眼] 先生平日闲暇，可亦涉猎古典文学？',
            '[歪头] 先生可知，热力学第二定律所示之“熵增”，常被叹为“时间之箭”永不回头。[微笑] 然则在人类文明格物致知之演进中，是否正是以心智构建秩序、逆流而上？愿闻先生教益。',
            '[点头] 物理学之至美，在于以至简之数理方程，括天地运转之万象。[微笑] 适才推导微积分方程，偶有所悟，先生此刻在关注何种学问？',
            '[思考] 亚里士多德言“求知是人类之天性”。古之学者视自然哲学为一体，今人则分门别类，精微有余而通达稍欠。[歪头] 不知先生以为然否？',
            '[微笑] 先生驻足良久，可是对案头的实验数据亦或窗外的风云光景有所感触？[点头] 愿与先生清谈片刻。'
        ];
        return topics[Math.floor(Math.random() * topics.length)];
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
