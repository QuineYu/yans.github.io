$(function(){
    var audio = $('#audioTag').get(0);
    var isDragging = false;

    // 播放/暂停控制
    $('#playPause').click(function(){
        togglePlay();
    });

    function togglePlay() {
        if (!audio) return;
        if (audio.paused) {
            audio.play().then(function() {
                $('.icon-btn').removeClass('icon-play').addClass('icon-pause');
                $('#albumCover').addClass('playing');
            }).catch(function(err) {
                console.log("播放需要用户交互或音频加载中:", err);
            });
        } else {
            audio.pause();
            $('.icon-btn').removeClass('icon-pause').addClass('icon-play');
            $('#albumCover').removeClass('playing');
        }
    }

    // 监听音频播放时间并更新进度条
    if (audio) {
        audio.addEventListener('timeupdate', updateProgress, false);
        audio.addEventListener('ended', audioEnded, false);

        // 读取音频长度，设置页面时长显示
        $('#audioTag').on("loadedmetadata", function () {
            if (this.duration && !isNaN(this.duration)) {
                $('#audioTime').text(transTime(this.duration));
            }
        });

        // 若元数据已就绪
        if (audio.readyState >= 1 && audio.duration) {
            $('#audioTime').text(transTime(audio.duration));
        }
    }

    // 进度条触控与点击定位核心算法
    function seekByClientX(clientX) {
        if (!audio || !audio.duration) return;
        var pgsElem = document.getElementById('progressBar');
        if (!pgsElem) return;

        var rect = pgsElem.getBoundingClientRect();
        var totalW = rect.width;
        var pgsWidth = totalW * 0.907; // 0.907 是进度条有效区域与总宽度的比例
        var startOffset = (totalW - pgsWidth) / 2;
        var clickX = clientX - rect.left - startOffset;

        var rate = clickX / pgsWidth;
        rate = Math.max(0, Math.min(1, rate));

        audio.currentTime = audio.duration * rate;
        updateProgress();
    }

    // 支持桌面端鼠标点击
    $('#progressBar').on('click', function (e) {
        seekByClientX(e.clientX);
    });

    // 支持移动端触摸滑动/轻按
    $('#progressBar').on('touchstart', function (e) {
        isDragging = true;
        if (e.originalEvent && e.originalEvent.touches && e.originalEvent.touches[0]) {
            seekByClientX(e.originalEvent.touches[0].clientX);
        }
    });

    $(window).on('touchmove', function (e) {
        if (isDragging && e.originalEvent && e.originalEvent.touches && e.originalEvent.touches[0]) {
            seekByClientX(e.originalEvent.touches[0].clientX);
        }
    });

    $(window).on('touchend touchcancel', function () {
        isDragging = false;
    });
});

// 转换音频时长显示
function transTime(time) {
    var duration = parseInt(time) || 0;
    var minute = parseInt(duration / 60);
    var sec = duration % 60;
    var minStr = (minute < 10 ? '0' : '') + minute;
    var secStr = (sec < 10 ? '0' : '') + sec;
    return minStr + ':' + secStr;
}

// 更新进度条
function updateProgress() {
    var audio = document.getElementById('audioTag');
    if (!audio || !audio.duration) return;

    var value = (audio.currentTime / audio.duration) * 100;
    $('#progress').css('width', (value * 0.907) + '%');
    $('.played-time').html(transTime(audio.currentTime));
}

// 播放完成
function audioEnded() {
    var audio = document.getElementById('audioTag');
    if (audio) {
        audio.currentTime = 0;
        audio.pause();
    }
    $('.play-pause > span').removeClass('icon-pause').addClass('icon-play');
    $('#albumCover').removeClass('playing');
    updateProgress();
}
