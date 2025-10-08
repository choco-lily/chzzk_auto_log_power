onload = (event) => {
    chrome.storage.sync.get("badge", (r) => {
        if (!r.badge == undefined) {
            r.badge = true;
            chrome.storage.sync.set({ badge: true });
        }

        let checkbox = document.getElementById("toggle");
        checkbox.checked = r.badge;
        checkbox.addEventListener("change", () => {
            chrome.storage.sync.set({ badge: checkbox.checked });
            // 즉시 content script에 변경사항 전달
            chrome.tabs.query({active: true, currentWindow: true}, (tabs) => {
                if (tabs[0] && tabs[0].url && tabs[0].url.includes('chzzk.naver.com')) {
                    chrome.tabs.sendMessage(tabs[0].id, {
                        action: 'updateBadgeToggle',
                        badgeToggle: checkbox.checked
                    });
                }
            });
        })
    });

    // 로그 보기 버튼 이벤트
    document.getElementById("viewLogs").addEventListener("click", () => {
        chrome.tabs.create({ url: chrome.runtime.getURL("log.html") });
    });
};
