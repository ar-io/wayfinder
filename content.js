/*document.body.addEventListener('click', function(e) {
    let arUrl = null;
    let targetBehavior = null;

    // Handle anchor (<a>) tags with ar:// protocol
    if (e.target.tagName === 'A' && e.target.href.startsWith('ar://')) {
        e.preventDefault();
        arUrl = e.target.href;
        targetBehavior = e.target.getAttribute('target');
    }

    // Handle image (<img>) tags with ar:// protocol
    else if (e.target.tagName === 'IMG' && e.target.src.startsWith('ar://')) {
        e.preventDefault();
        arUrl = e.target.src;
    }

    // Handle iframe tags with ar:// protocol
    else if (e.target.tagName === 'IFRAME' && e.target.src.startsWith('ar://')) {
        e.preventDefault();
        arUrl = e.target.src;
    }

    // Handle audio tags with ar:// protocol
    else if (e.target.tagName === 'AUDIO' && e.target.currentSrc.startsWith('ar://')) {
        e.preventDefault();
        arUrl = e.target.currentSrc;
    }

    // Handle video tags with ar:// protocol
    else if (e.target.tagName === 'VIDEO') {
        const sources = e.target.getElementsByTagName('source');
        for (let i = 0; i < sources.length; i++) {
            if (sources[i].src.startsWith('ar://')) {
                e.preventDefault();
                arUrl = sources[i].src;
                break;
            }
        }
        if (!arUrl && e.target.src.startsWith('ar://')) {
            e.preventDefault();
            arUrl = e.target.src;
        }
    }

    // If we've identified an ar:// URL, send a message to the background script
    if (arUrl) {
        chrome.runtime.sendMessage({ 
            type: 'arUrlClicked', 
            arUrl,
            target: targetBehavior 
        }, (response) => {
            // Handle potential responses from the background script or error handling here.
            if (chrome.runtime.lastError) {
                console.error(chrome.runtime.lastError);
            } else if (response && response.error) {
                console.error(response.error);
            }
        });
    }
});*/

document.addEventListener('DOMContentLoaded', function() {
    // Gather all elements with `ar://` protocol
    const arElements = document.querySelectorAll('a[href^="ar://"], img[src^="ar://"], iframe[src^="ar://"], audio > source[src^="ar://"], video > source[src^="ar://"]');

    arElements.forEach(element => {
        if (element.tagName === 'A') {
            element.addEventListener('click', function(e) {
                e.preventDefault();

                const arUrl = e.target.href;

                // Determine the target behavior
                let targetBehavior = e.target.getAttribute('target');

                // Communicate with background script to handle routing
                chrome.runtime.sendMessage({ 
                    type: 'arUrlClicked', 
                    arUrl,
                    target: targetBehavior 
                });
            });
        }
        if (element.tagName === 'IMG') {
            const arUrl = element.getAttribute('src');
            const placeholder = 'icon128.png'; // provide the path to your placeholder image
            
            element.src = placeholder; // set the placeholder while loading AR content

            // Assuming your background script can fetch and process the AR content and return a displayable image
            chrome.runtime.sendMessage({
                type: 'arImageUrlRequested',
                arUrl
            }, response => {
                if (response && response.imageUrl) {
                    element.src = response.imageUrl; // Replace with the actual image provided by the AR content
                } else {
                    // Handle any errors, e.g., by displaying a different error placeholder
                    element.src = 'icon128.png';
                }
            });

            element.addEventListener('click', function() {
                // When the image is clicked, you can have further interactivity, 
                // such as opening the full AR experience
                chrome.runtime.sendMessage({ 
                    type: 'arImgClicked', 
                    arUrl 
                });
            });
        }
        // Add handling for other tags as necessary. 
        // For images, videos, etc., you might want to replace them with placeholders or provide overlays, 
        // and then handle user interactions such as clicks or hovers accordingly.
    });
});

