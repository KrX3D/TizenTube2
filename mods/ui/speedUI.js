import { configRead } from '../config.js';
import { showModal, buttonItem, overlayPanelItemListRenderer } from './ytUI.js';

const interval = setInterval(() => {
    const videoElement = document.querySelector('video');
    if (videoElement) {
        execute_once_dom_loaded_speed();
        clearInterval(interval);
    }
}, 1000);

function execute_once_dom_loaded_speed() {
    document.querySelector('video').addEventListener('canplay', () => {
        document.getElementsByTagName('video')[0].playbackRate = configRead('videoSpeed');;
    });

    // Red, Green, Yellow, Blue
    // 403, 404, 405, 406
    // ---, 172, 170, 191
    document.addEventListener('keydown', eventHandler, true);
    document.addEventListener('keypress', eventHandler, true);
    document.addEventListener('keyup', eventHandler, true);
}