if(document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded',afterDOMLoaded);
} else {
    afterDOMLoaded();
}

async function afterDOMLoaded(){

    // Gather all elements with `ar://` protocol
    const arElements = document.querySelectorAll(
        'a[href^="ar://"], img[src^="ar://"], iframe[src^="ar://"], ' +
        'audio > source[src^="ar://"], video > source[src^="ar://"], ' +
        'link[href^="ar://"], embed[src^="ar://"], object[data^="ar://"]'
    );

    arElements.forEach(element => {
        let arUrl;
        switch(element.tagName) {
            case 'A':
                arUrl = element.href;
                chrome.runtime.sendMessage({ type: 'convertArUrlToHttpUrl', arUrl }, response => {
                    if (response && response.url) {
                        element.href = response.url;
                    } else {
                        console.error(`Failed to load image: ${response.error}`);
                    }
                });
                break;
            case 'IMG':
                arUrl = element.getAttribute('src');
                chrome.runtime.sendMessage({ type: 'convertArUrlToHttpUrl', arUrl }, response => {
                    if (response && response.url) {
                        element.src = response.url;
                    } else {
                        console.error(`Failed to load image: ${response.error}`);
                    }
                });
                break;
            case 'IFRAME':
                arUrl = element.getAttribute('src');
                chrome.runtime.sendMessage({ type: 'convertArUrlToHttpUrl', arUrl }, response => {
                    if (response && response.url) {
                        element.src = response.url;
                    } else {
                        console.error(`Failed to load image: ${response.error}`);
                    }
                });
                break;
            case 'SOURCE':
                arUrl = element.getAttribute('src');
                if (element.parentNode.tagName === 'AUDIO') {
                    chrome.runtime.sendMessage({ type: 'convertArUrlToHttpUrl', arUrl }, response => {
                        if (response && response.url) {
                            element.src = response.url;
                            element.parentNode.load(); // Load the media element with the new source
                        } else {
                            console.error(`Failed to load image: ${response.error}`);
                        }
                    });
                    break;
                } else if (element.parentNode.tagName === 'VIDEO') {
                    chrome.runtime.sendMessage({ type: 'convertArUrlToHttpUrl', arUrl }, response => {
                        if (response && response.url) {
                            element.src = response.url;
                            element.parentNode.load(); // Load the media element with the new source
                        } else {
                            console.error(`Failed to load image: ${response.error}`);
                        }
                    });
                    break;
                } else {
                    console.error('Unexpected parent for source element', element);
                }
                break;
            case 'LINK':
                arUrl = element.getAttribute('href');
                chrome.runtime.sendMessage({ type: 'convertArUrlToHttpUrl', arUrl }, response => {
                    if (response && response.url) {
                        // Create a clone of the original element
                        const newLinkEl = element.cloneNode();

                        // Set the new URL to the cloned element
                        newLinkEl.href = response.url;
                        
                        // Replace the old link element with the new one
                        element.parentNode.replaceChild(newLinkEl, element);
                    } else {
                        console.error(`Failed to load link element: ${response.error}`);
                    }
                });
                break;
            case 'EMBED':
                arUrl = element.getAttribute('src');
                chrome.runtime.sendMessage({ type: 'convertArUrlToHttpUrl', arUrl }, response => {
                    if (response && response.url) {
                        element.src = response.url; // Set the new URL
                    } else {
                        console.error(`Failed to load embed element: ${response.error}`);
                    }
                });
                break;
            case 'OBJECT':
                arUrl = element.getAttribute('data');
                chrome.runtime.sendMessage({ type: 'convertArUrlToHttpUrl', arUrl }, response => {
                    if (response && response.url) {
                        element.data = response.url; // Set the new URL
                    } else {
                        console.error(`Failed to load object: ${response.error}`);
                    }
                });
                break;
            default:
                console.error('Unexpected element', element);
        }
    });
}
