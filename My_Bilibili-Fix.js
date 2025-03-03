// ==UserScript==
// @name         哔哩哔哩(B站|Bilibili)收藏夹Fix
// @namespace    http://tampermonkey.net/
// @version      1.2.4
// @description  修复 哔哩哔哩(www.bilibili.com) 失效的收藏。（可查看av号、简介、标题、封面）
// @author       Mr.Po
// @match        https://space.bilibili.com/*
// @require      https://cdnjs.cloudflare.com/ajax/libs/jquery/1.11.0/jquery.min.js
// @resource iconError https://cdn.jsdelivr.net/gh/Mr-Po/bilibili-favorites-fix/media/error.png
// @resource iconSuccess https://cdn.jsdelivr.net/gh/Mr-Po/bilibili-favorites-fix/media/success.png
// @resource iconInfo https://cdn.jsdelivr.net/gh/Mr-Po/bilibili-favorites-fix/media/info.png
// @connect      biliplus.com
// @grant        GM_xmlhttpRequest
// @grant        GM_notification
// @grant        GM_setClipboard
// @grant        GM_getResourceURL
// @downloadURL https://update.greasyfork.org/scripts/383143/%E5%93%94%E5%93%A9%E5%93%94%E5%93%A9%28B%E7%AB%99%7CBilibili%29%E6%94%B6%E8%97%8F%E5%A4%B9Fix.user.js
// @updateURL https://update.greasyfork.org/scripts/383143/%E5%93%94%E5%93%A9%E5%93%94%E5%93%A9%28B%E7%AB%99%7CBilibili%29%E6%94%B6%E8%97%8F%E5%A4%B9Fix.meta.js
// ==/UserScript==

/*jshint esversion: 8 */
(function() {
    'use strict';

    console.log("脚本已加载 - Bilibili 收藏夹 Fix");

    /** 失效收藏标题颜色(默认为灰色)。 */
    const invalTitleColor = "#999";
    /** 是否启用调试模式。 */
    const isDebug = true; // 调试模式开启，方便查看日志
    /** 重试延迟[秒]。 */
    const retryDelay = 2; // 缩短到2秒
    /** 每隔 space [毫秒]检查一次，是否有新的收藏被加载出来。 */
    const space = 2000;
    /** 请求超时时间[毫秒]。 */
    const requestTimeout = 30000; // 延长到30秒
    /** 请求之间的延迟[毫秒]。 */
    const requestDelay = 1000; // 保持1秒
    /** 最大重试次数。 */
    const maxRetries = 3; // 增加到3次
    /** 缓存已获取的视频信息。 */
    const videoInfoCache = new Map();

    /** 收藏夹地址正则 */
    const favlistRegex = /https:\/\/space\.bilibili\.com\/\d+\/favlist/;

    /** 处理收藏 */
    function handleFavorites() {
        if (isDebug) console.log("进入 handleFavorites 函数");

        const flag = favlistRegex.test(window.location.href);
        if (isDebug) console.log("当前 URL:", window.location.href, "是否匹配收藏夹:", flag);

        if (flag) {
            const $items = $(".items__item");
            const $lis = $items.filter(function() {
                const $title = $(this).find(".bili-video-card__title a");
                return $title.text().trim() === "已失效视频";
            });
            if (isDebug) console.log("找到的失效收藏数量:", $lis.size());

            if ($lis.size() > 0) {
                console.info(`${$lis.size()}个收藏待修复...`);

                const promises = $lis.map(function(i, it) {
                    return new Promise((resolve) => {
                        setTimeout(() => {
                            const $titleLink = $(it).find(".bili-video-card__title a");
                            const href = $titleLink.attr("href");
                            const bvMatch = href.match(/BV\w+/);
                            if (bvMatch) {
                                const bv = bvMatch[0];
                                const aid = bv2aid(bv);
                                if (isDebug) console.log(`处理第 ${i + 1} 个失效收藏，BV: ${bv}, AID: ${aid}`);

                                const $as = $(it).find("a");
                                $as.attr("href", `https://www.biliplus.com/video/av${aid}/`);
                                $as.attr("target", "_blank");
                                addCopyAVCodeButton($(it), aid);
                                fixTitleAndPic($(it), $titleLink, aid, 0); // 传入重试次数
                                $(it).removeClass("disabled");
                                $as.removeClass("disabled");
                                resolve();
                            } else {
                                console.warn(`无法提取BV号: ${href}`);
                                resolve();
                            }
                        }, i * requestDelay);
                    });
                }).get();

                Promise.all(promises).then(() => {
                    showDetail($lis);
                    if (isDebug) console.log("所有收藏修复完成");
                });
            }
        }
    }

    /** 添加操作项到下拉菜单 */
    function addOperation($item, name, fun) {
        const $ul = $item.find(".be-dropdown-menu").first();
        const lastChild = $ul.children().last();
        if (!lastChild.hasClass('be-dropdown-item-extend')) {
            lastChild.addClass("be-dropdown-item-delimiter");
        }
        const $li = $(`<li class="be-dropdown-item be-dropdown-item-extend">${name}</li>`);
        $li.click(fun);
        $ul.append($li);
    }

    /** 添加复制AV号按钮 */
    function addCopyAVCodeButton($item, aid) {
        addOperation($item, "复制av号", function() {
            GM_setClipboard(`av${aid}`, "text");
            tipSuccess("av号复制成功！");
        });
    }

    /** 标记失效视频 */
    function signInval($it, $a) {
        const $pubdate = $it.find("div.meta.pubdate");
        $pubdate.attr("style", "text-decoration:line-through");
        $a.attr("style", `text-decoration:line-through;color:${invalTitleColor};`);
    }

    /** 修复收藏信息 */
    function fixFavorites($it, $a, aid, title, pic, history) {
        $a.text(title);
        $a.attr("title", title);
        const $as = $it.find("a");
        $as.attr("href", `https://www.biliplus.com/${history}video/av${aid}/`);
        signInval($it, $a);
        isLoad(pic, function() {
            const $img = $it.find("img");
            $img.attr("src", pic);
        });
    }

    /** 修复标题和封面 */
    function fixTitleAndPic($it, $a, aid, retryCount = 0) {
        if (isDebug) console.log(`进入 fixTitleAndPic 函数，AID: ${aid}, 重试次数: ${retryCount}`);
        $a.text("Loading...");

        // 检查缓存
        if (videoInfoCache.has(aid)) {
            const cachedInfo = videoInfoCache.get(aid);
            if (cachedInfo) {
                fixFavorites($it, $a, aid, cachedInfo.title, cachedInfo.pic, "");
                return;
            }
        }

        // 请求 BiliPlus API
        GM_xmlhttpRequest({
            method: 'GET',
            url: `https://www.biliplus.com/api/view?id=${aid}`,
            responseType: "json",
            timeout: requestTimeout,
            onload: function(response) {
                const res = response.response;
                if (res.title) {
                    fixFavorites($it, $a, aid, res.title, res.pic, "");
                    videoInfoCache.set(aid, { title: res.title, pic: res.pic });
                } else if (res.code == -503 && retryCount < maxRetries) {
                    if (isDebug) console.log(`AID: ${aid} 返回503，重试 ${retryCount + 1}/${maxRetries}`);
                    setTimeout(() => fixTitleAndPic($it, $a, aid, retryCount + 1), retryDelay * 1000);
                } else {
                    $a.text(`修复失败（${aid}）`);
                    $a.attr("title", `API返回异常: ${res.code || '未知'}`);
                }
            },
            onerror: function(e) {
                if (retryCount < maxRetries) {
                    if (isDebug) console.log(`AID: ${aid} 网络错误，重试 ${retryCount + 1}/${maxRetries}`);
                    setTimeout(() => fixTitleAndPic($it, $a, aid, retryCount + 1), retryDelay * 1000);
                } else {
                    $a.text(`修复失败（${aid}）`);
                    $a.attr("title", "网络错误");
                }
            },
            ontimeout: function() {
                if (retryCount < maxRetries) {
                    if (isDebug) console.log(`AID: ${aid} 请求超时，重试 ${retryCount + 1}/${maxRetries}`);
                    setTimeout(() => fixTitleAndPic($it, $a, aid, retryCount + 1), retryDelay * 1000);
                } else {
                    $a.text(`修复失败（${aid}）`);
                    $a.attr("title", "请求超时");
                }
            }
        });
    }

    /** BV号转AID */
    const bvTable = "fZodR9XQDSUm21yCkr6zBqiveYah8bt4xsWpHnJE7jL5VG3guMTKNPAwcF";
    const bvArray = [
        { bvIndex: 11, bvTimes: 1 },
        { bvIndex: 10, bvTimes: 58 },
        { bvIndex: 3, bvTimes: 3364 },
        { bvIndex: 8, bvTimes: 195112 },
        { bvIndex: 4, bvTimes: 11316496 },
        { bvIndex: 6, bvTimes: 656356768 },
    ];
    const bvXor = 177451812;
    const bvAdd = 8728348608;

    function bv2aid(bv) {
        const value = bvArray
            .map(it => bvTable.indexOf(bv[it.bvIndex]) * it.bvTimes)
            .reduce((total, num) => total + num);
        return (value - bvAdd) ^ bvXor;
    }

    /** 通知函数 */
    function tipSuccess(text) {
        GM_notification({ text: text, image: GM_getResourceURL("iconSuccess") });
    }

    setInterval(handleFavorites, space);
    if (isDebug) console.log("已设置定时器，每", space, "毫秒检查一次 handleFavorites");
})();
