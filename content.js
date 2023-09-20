// checks for <a href="ar://..."> pattern
document.body.addEventListener('click', function(e) {
    if (e.target.tagName === 'A' && e.target.href.startsWith('ar://')) {
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
    }
});
