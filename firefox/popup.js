onload = (event) => {
    browser.storage.sync.get("badge").then((r) => {
        if (r.badge == undefined) {
            r.badge = true;
            browser.storage.sync.set({ badge: true });
        }

        let checkbox = document.getElementById("toggle");
        checkbox.checked = r.badge;
        checkbox.addEventListener("change", () => {
            browser.storage.sync.set({ badge: checkbox.checked });
            // 즉시 content script에 변경사항 전달
            browser.tabs.query({active: true, currentWindow: true}).then((tabs) => {
                if (tabs[0] && tabs[0].url && tabs[0].url.includes('chzzk.naver.com')) {
                    browser.tabs.sendMessage(tabs[0].id, {
                        action: 'updateBadgeToggle',
                        badgeToggle: checkbox.checked
                    });
                }
            }).catch((error) => {
                console.error("Tabs query error:", error);
            });
        })
    }).catch((error) => {
        console.error("Storage sync get error:", error);
        // 기본값으로 설정
        let checkbox = document.getElementById("toggle");
        checkbox.checked = true;
        checkbox.addEventListener("change", () => {
            browser.storage.sync.set({ badge: checkbox.checked });
        });
    });

    // 로그 보기 버튼 이벤트
    document.getElementById("viewLogs").addEventListener("click", () => {
        browser.tabs.create({ url: browser.runtime.getURL("log.html") });
    });
};
