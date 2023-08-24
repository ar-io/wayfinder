if(document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded',afterDOMLoaded);
} else {
    afterDOMLoaded();
}

async function afterDOMLoaded(){
    const gatewayList = document.getElementById('gatewayList');
    const gatewayListTitle = document.getElementById('gatewayListTitle');
    const gatewayListHeader = document.getElementById('gatewayListHeader');
    const refreshGatewaysBtn = document.getElementById("refreshGateways");
    const showGatewaysBtn = document.getElementById('showGateways');
    const showSettingsBtn = document.getElementById('showSettings');
    const aboutSection = document.getElementById('aboutSection');
    const settingsSection = document.getElementById('settingsSection');
    const settingsListTitle = document.getElementById('settingsListTitle');
    const showHistoryBtn = document.getElementById("showHistory");
    const historyList = document.getElementById("historyList");
    const historyListTitle = document.getElementById("historyListTitle");

    showGatewaysBtn.addEventListener('click', async function() {
        if (gatewayList.style.display === 'block') {
            aboutSection.style.display = 'block';
            showSettingsBtn.style.display = 'block';
            showHistoryBtn.style.display = 'block';
            gatewayListHeader.style.display = 'none';
            gatewayListTitle.style.display = 'none';
            gatewayList.style.display = 'none';
            refreshGatewaysBtn.style.display = 'none';
            showGatewaysBtn.innerText = 'Display Gateway Address Registry';
        } else {
            gatewayList.innerHTML = '';
            chrome.storage.local.get('gateways', async function(result) {
                const gateways = result.gateways;
                const onlineGateways = await getOnlineGateways();
                for (let i = 0; i < gateways.length; i++) {
                    let statusIcon = '<span class="offline">✖</span>'
                    if (onlineGateways.includes(gateways[i])){
                        statusIcon = '<span class="online">✔</span>'
                    }
                    const listItem = document.createElement('li');
                    listItem.innerHTML = `<a href="https://${gateways[i]}" target="_blank">${gateways[i]}</a> ${statusIcon} `;
                    gatewayList.appendChild(listItem);
                }
                document.getElementById('onlineGatewayCount').textContent = onlineGateways.length;
                document.getElementById('totalGatewayCount').textContent = gateways.length;

                showSettingsBtn.style.display = 'none';
                aboutSection.style.display = 'none';  // hide the "about" section
                showHistoryBtn.style.display = 'none';
                showSettingsBtn.style.display = 'hide';
                gatewayListHeader.style.display = 'block';
                gatewayList.style.display = 'block';
                gatewayListTitle.style.display = 'block';
                refreshGatewaysBtn.style.display = 'block'
                showGatewaysBtn.innerText = 'Hide Gateway Address Registry';
            });
        }
    });

    refreshGatewaysBtn.addEventListener("click", async function() {
        gatewayList.innerHTML = '';
        await refreshOnlineGateways();
        chrome.storage.local.get('gateways', async function(result) {
            const gateways = result.gateways;
            const onlineGateways = await getOnlineGateways();
            for (let i = 0; i < gateways.length; i++) {
                let statusIcon = '<span class="offline">✖</span>'
                if (onlineGateways.includes(gateways[i])){
                    statusIcon = '<span class="online">✔</span>'
                } else {
                }
                const listItem = document.createElement('li');
                listItem.innerHTML = `<a href="https://${gateways[i]}" target="_blank">${gateways[i]}</a> ${statusIcon} `;
                gatewayList.appendChild(listItem);
            }
            document.getElementById('onlineGatewayCount').textContent = onlineGateways.length;
            document.getElementById('totalGatewayCount').textContent = gateways.length;
        });
    });

    showHistoryBtn.addEventListener("click", async function() {
        if(historyList.style.display === "none") {
            chrome.storage.local.get("history", function(data) {
                const history = data.history || [];
                historyList.innerHTML = ''; // Clear previous items
                history.forEach(item => {
                    const listItem = document.createElement('li');
                    listItem.innerHTML = `<a href="https://viewblock.io/arweave/tx/${item.resolvedId}" target="_blank">${item.url}</a>${new Date(item.timestamp).toLocaleString()}`;
                    historyList.appendChild(listItem);
                });
                historyList.style.display = 'block';
                historyListTitle.style.display = 'block';
                showHistoryBtn.innerText = 'Hide Usage History';
                showSettingsBtn.style.display = 'none';
                aboutSection.style.display = 'none'; 
                showSettingsBtn.style.display = 'none';
                showGatewaysBtn.style.display = 'none';
            });
        } else {
            historyList.style.display = 'none';
            historyListTitle.style.display = 'none';
            showHistoryBtn.innerText = 'Usage History';
            showSettingsBtn.style.display = 'block';
            aboutSection.style.display = 'block'; 
            showSettingsBtn.style.display = 'block';
            showGatewaysBtn.style.display = 'block';
        }
    });

    showSettingsBtn.addEventListener('click', function() {
        if(settingsSection.style.display === "none") {
            aboutSection.style.display = 'none';  // hide the "about" section
            showGatewaysBtn.style.display = 'none';
            showHistoryBtn.style.display = 'none';
            settingsSection.style.display = "block"; // show the "settings" section
            settingsListTitle.style.display = 'block';
            showSettingsBtn.innerText = 'Hide';
        } else {
            aboutSection.style.display = 'block'; // show the "about" section
            showGatewaysBtn.style.display = 'block';
            showHistoryBtn.style.display = 'block';
            settingsListTitle.style.display = 'none';
            settingsSection.style.display = "none"; // hide the "settings" sections
            showSettingsBtn.innerText = 'Settings';
        }
    });

    const themeToggle = document.getElementById("themeToggle");
    const body = document.body;
    themeToggle.addEventListener("change", function() {
        const selectedTheme = this.value;
        if (selectedTheme === "dark") {
            body.classList.add("body");
            body.classList.remove("light-mode");
        } else if (selectedTheme === "light") {
            body.classList.add("light-mode");
            body.classList.remove("body");
        }
    });

    const saveButton = document.getElementById('saveStaticGateway');
    saveButton.addEventListener('click', function() {
        const gatewayValue = document.getElementById('staticGateway').value;
        console.log ("Saving gateway: ",gatewayValue)
        chrome.storage.local.set({ 'staticGateway': gatewayValue }, function(gatewayValue) {
            alert('Static gateway saved.', gatewayValue);
        });
    });

    chrome.storage.local.get('staticGateway', function(data) {
        if (data.staticGateway) {
            document.getElementById('staticGateway').value = data.staticGateway;
        }
    });
}

async function getOnlineGateways() {
    return new Promise((resolve, reject) => {
        chrome.runtime.sendMessage({message: "getOnlineGateways"}, function(response) {
            if (chrome.runtime.lastError) {
                reject(new Error(chrome.runtime.lastError));
            } else {
                resolve(response.onlineGateways);
            }
        });
    });
}

async function refreshOnlineGateways() {
    return new Promise((resolve, reject) => {
        // TO DO: fix this and handle rejects
        chrome.runtime.sendMessage({message: "refreshOnlineGateways"}, function(response) {
                resolve(response);
        });
    });
}