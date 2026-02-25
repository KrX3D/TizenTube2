import { configRead } from '../config.js';
import { showModal, buttonItem, overlayPanelItemListRenderer, scrollPaneRenderer, overlayMessageRenderer, QrCodeRenderer } from './ytUI.js';
import qrcode from 'qrcode-npm';

const qrcodes = {};

export default function modernUI(update, parameters) {
    const settings = [
        {
            name: 'Miscellaneous',
            icon: 'SETTINGS',
            value: null,
            options: [
                {
                    name: 'Fix UI',
                    icon: 'STAR',
                    value: 'enableFixedUI'
                },
                {
                    name: 'Shorts',
                    icon: 'YOUTUBE_SHORTS_FILL_24',
                    value: 'enableShorts'
                }
            ]
        },
        {
            name: 'Video Player Settings',
            icon: 'VIDEO_YOUTUBE',
            value: null,
            menuHeader: {
                title: 'Video Player Settings',
                subtitle: 'Customize video player features'
            },
            options: [
                {
                    name: 'Patch Video Player UI',
                    icon: 'SETTINGS',
                    value: null,
                    menuId: 'tt-video-player-ui-patching',
                    options: [
                        {
                            name: 'Enable Video Player UI Patching',
                            icon: 'SETTINGS',
                            value: 'enablePatchingVideoPlayer'
                        },
                        {
                            name: 'Previous and Next Buttons',
                            icon: 'SKIP_NEXT',
                            value: 'enablePreviousNextButtons'
                        },
                    ]
                }
            ]
        },
        {
            name: 'User Interface Settings',
            icon: 'SETTINGS',
            value: null,
            menuHeader: {
                title: 'User Interface Settings',
                subtitle: 'Customize the UI to your liking'
            },
            options: [
                {
                    name: 'Hide Watched Videos',
                    icon: 'VISIBILITY_OFF',
                    value: null,
                    menuId: 'tt-hide-watched-videos-settings',
                    options: [
                        {
                            name: 'Enable Hide Watched Videos',
                            icon: 'VISIBILITY_OFF',
                            value: 'enableHideWatchedVideos'
                        },
                        {
                            name: 'Watched Videos Threshold',
                            value: null,
                            menuId: 'tt-hide-watched-videos-threshold',
                            menuHeader: {
                                title: 'Watched Videos Threshold',
                                subtitle: 'Set the percentage threshold for hiding watched videos'
                            },
                            options: [0, 5, 10, 20, 30, 40, 50, 60, 70, 80, 90, 100].map((percent) => {
                                return {
                                    name: `${percent}%`,
                                    key: 'hideWatchedVideosThreshold',
                                    value: percent
                                }
                            })
                        },
                        {
                            name: 'Set Pages to Hide Watched Videos',
                            value: null,
                            arrayToEdit: 'hideWatchedVideosPages',
                            menuId: 'tt-hide-watched-videos-pages',
                            options: [
                                {
                                    name: 'Search Results',
                                    value: 'search'
                                },
                                {
                                    name: 'Home',
                                    value: 'home'
                                },
                                {
                                    name: 'Music',
                                    value: 'music'
                                },
                                {
                                    name: 'Gaming',
                                    value: 'gaming'
                                },
                                {
                                    name: 'Subscriptions',
                                    value: 'subscriptions'
                                },
                                {
                                    name: 'Channel Pages',
                                    value: 'channel'
                                },
                                {
                                    name: 'Library',
                                    value: 'library'
                                },
                                {
                                    name: 'Library → Playlists Overview', //Subscriptions -> Playlists - arent probably removed since no indication if all videos in the Playlist are watched
                                    icon: 'PLAYLIST_PLAY',
                                    value: 'playlists'
                                },
                                {
                                    name: 'Library → Individual Playlists (WL, LL, etc)',
                                    icon: 'PLAYLIST_PLAY',
                                    value: 'playlist'
                                },
                                {
                                    name: 'Library → History',
                                    icon: 'HISTORY',
                                    value: 'history'
                                },
                                {
                                    name: 'More',
                                    value: 'more'
                                },
                                {
                                    name: 'Watch',
                                    value: 'watch'
                                }
                            ]
                        }
                    ]
                },
                {
                    name: 'Screen Dimming',
                    icon: 'EYE_OFF',
                    value: null,
                    menuId: 'tt-screen-dimming-settings',
                    options: [
                        {
                            name: 'Enable Screen Dimming',
                            icon: 'EYE_OFF',
                            value: 'enableScreenDimming'
                        },
                        {
                            name: 'Dimming Timeout',
                            icon: 'TIMER',
                            value: null,
                            menuId: 'tt-dimming-timeout',
                            menuHeader: {
                                title: 'Dimming Timeout',
                                subtitle: 'Set the inactivity timeout (in seconds) before the screen dims'
                            },
                            options: [10, 20, 30, 60, 120, 180, 240, 300].map((seconds) => {
                                const title = seconds >= 60 ? `${seconds / 60} minute${seconds / 60 > 1 ? 's' : ''}` : `${seconds} seconds`;
                                return {
                                    name: title,
                                    key: 'dimmingTimeout',
                                    value: seconds
                                }
                            })
                        },
                        {
                            name: 'Dimming Opacity',
                            icon: 'LENS_BLUE',
                            value: null,
                            menuId: 'tt-dimming-opacity',
                            menuHeader: {
                                title: 'Dimming Opacity',
                                subtitle: 'Set the opacity level for screen dimming'
                            },
                            options: [0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9, 1.0].map((opacity) => {
                                return {
                                    name: `${Math.round(opacity * 100)}%`,
                                    key: 'dimmingOpacity',
                                    value: opacity
                                }
                            })
                        }
                    ]
                },
                {
                    name: 'Disable Sidebar Contents (Guide Actions)',
                    icon: 'MENU',
                    value: null,
                    arrayToEdit: 'disabledSidebarContents',
                    menuId: 'tt-sidebar-contents',
                    menuHeader: {
                        title: 'Disable Sidebar Contents',
                        subtitle: 'Select sidebar contents (guide actions) to disable'
                    },
                    options: [
                        {
                            name: 'Search',
                            icon: 'SEARCH',
                            value: 'SEARCH'
                        },
                        {
                            name: 'Home',
                            icon: 'WHAT_TO_WATCH',
                            value: 'WHAT_TO_WATCH'
                        },
                        {
                            name: 'Sports',
                            icon: 'TROPHY',
                            value: 'TROPHY'
                        },
                        {
                            name: 'News',
                            icon: 'NEWS',
                            value: 'NEWS'
                        },
                        {
                            name: 'Music',
                            icon: 'YOUTUBE_MUSIC',
                            value: 'YOUTUBE_MUSIC'
                        },
                        {
                            name: 'Podcasts',
                            icon: 'BROADCAST',
                            value: 'BROADCAST'
                        },
                        {
                            name: 'Movies & TV',
                            icon: 'CLAPPERBOARD',
                            value: 'CLAPPERBOARD'
                        },
                        {
                            name: 'Live',
                            icon: 'LIVE',
                            value: 'LIVE'
                        },
                        {
                            name: 'Gaming',
                            icon: 'GAMING',
                            value: 'GAMING'
                        },
                        {
                            name: 'Subscriptions',
                            icon: 'SUBSCRIPTIONS',
                            value: 'SUBSCRIPTIONS'
                        },
                        {
                            name: 'Library',
                            icon: 'TAB_LIBRARY',
                            value: 'TAB_LIBRARY'
                        },
                        {
                            name: 'More',
                            icon: 'TAB_MORE',
                            value: 'TAB_MORE'
                        }
                    ]
                },
                {
                    name: 'Launch to on startup',
                    icon: 'TV',
                    value: null,
                    menuId: 'tt-launch-to-on-startup',
                    menuHeader: {
                        title: 'Launch to on startup',
                        subtitle: 'Choose the default page TizenTube opens to on startup'
                    },
                    options: [
                        {
                            name: 'Search',
                            icon: 'SEARCH',
                            key: 'launchToOnStartup',
                            value: JSON.stringify({
                                searchEndpoint: { query: '' }
                            })
                        },
                        {
                            name: 'Home',
                            icon: 'WHAT_TO_WATCH',
                            key: 'launchToOnStartup',
                            value: JSON.stringify({
                                browseEndpoint: { browseId: 'FEtopics' }
                            })
                        },
                        {
                            name: 'Sports',
                            icon: 'TROPHY',
                            key: 'launchToOnStartup',
                            value: JSON.stringify({
                                browseEndpoint: { browseId: 'FEtopics_sports' }
                            })
                        },
                        {
                            name: 'News',
                            icon: 'NEWS',
                            key: 'launchToOnStartup',
                            value: JSON.stringify({
                                browseEndpoint: { browseId: 'FEtopics_news' }
                            })
                        },
                        {
                            name: 'Music',
                            icon: 'YOUTUBE_MUSIC',
                            key: 'launchToOnStartup',
                            value: JSON.stringify({
                                browseEndpoint: { browseId: 'FEtopics_music' }
                            })
                        },
                        {
                            name: 'Podcasts',
                            icon: 'BROADCAST',
                            key: 'launchToOnStartup',
                            value: JSON.stringify({
                                browseEndpoint: { browseId: 'FEtopics_podcasts' }
                            })
                        },
                        {
                            name: 'Movies & TV',
                            icon: 'CLAPPERBOARD',
                            key: 'launchToOnStartup',
                            value: JSON.stringify({
                                browseEndpoint: { browseId: 'FEtopics_movies' }
                            })
                        },
                        {
                            name: 'Gaming',
                            icon: 'GAMING',
                            key: 'launchToOnStartup',
                            value: JSON.stringify({
                                browseEndpoint: { browseId: 'FEtopics_gaming' }
                            })
                        },
                        {
                            name: 'Live',
                            icon: 'LIVE',
                            key: 'launchToOnStartup',
                            value: JSON.stringify({
                                browseEndpoint: { browseId: 'FEtopics_live' }
                            })
                        },
                        {
                            name: 'Subscriptions',
                            icon: 'SUBSCRIPTIONS',
                            key: 'launchToOnStartup',
                            value: JSON.stringify({
                                browseEndpoint: { browseId: 'FEsubscriptions' }
                            })
                        },
                        {
                            name: 'Library',
                            icon: 'TAB_LIBRARY',
                            key: 'launchToOnStartup',
                            value: JSON.stringify({
                                browseEndpoint: { browseId: 'FElibrary' }
                            })
                        },
                        {
                            name: 'More',
                            icon: 'TAB_MORE',
                            key: 'launchToOnStartup',
                            value: JSON.stringify({
                                browseEndpoint: { browseId: 'FEtopics_more' }
                            })
                        }
                    ]
                }
            ]
        },

        window.h5vcc && window.h5vcc.tizentube ?
            {
                name: 'TizenTube Cobalt Updater',
                icon: 'SYSTEM_UPDATE',
                value: null,
                menuHeader: {
                    title: 'TizenTube Cobalt Updater',
                    subtitle: 'Manage TizenTube Cobalt updates'
                },
                subtitle: `Current version: ${window.h5vcc.tizentube.GetVersion()}`,
                options: [
                    buttonItem(
                        { title: 'Check for Updates' },
                        { icon: 'SYSTEM_UPDATE' },
                        [
                            {
                                customAction: {
                                    action: 'CHECK_FOR_UPDATES',
                                }
                            }
                        ]
                    ),
                    {
                        name: 'Check for updates on startup',
                        icon: 'SYSTEM_UPDATE',
                        value: 'enableUpdater'
                    }
                ]
            } : null
    ];

    const buttons = [];

    let index = 0;
    for (const setting of settings) {
        if (!setting) continue;
        const currentVal = setting.value ? configRead(setting.value) : null;
        buttons.push(
            buttonItem(
                { title: setting.name, subtitle: setting.subtitle },
                {
                    icon: setting.icon ? setting.icon : 'CHEVRON_DOWN',
                    secondaryIcon:
                        currentVal === null ? 'CHEVRON_RIGHT' : currentVal ? 'CHECK_BOX' : 'CHECK_BOX_OUTLINE_BLANK'
                },
                currentVal !== null
                    ? [
                        {
                            setClientSettingEndpoint: {
                                settingDatas: [
                                    {
                                        clientSettingEnum: {
                                            item: setting.value
                                        },
                                        boolValue: !configRead(setting.value)
                                    }
                                ]
                            }
                        },
                        {
                            customAction: {
                                action: 'SETTINGS_UPDATE',
                                parameters: [index]
                            }
                        }
                    ]
                    : [
                        {
                            customAction: {
                                action: 'OPTIONS_SHOW',
                                parameters: {
                                    options: setting.options,
                                    selectedIndex: 0,
                                    update: setting.options?.title ? 'customUI' : false,
                                    menuId: setting.menuId,
                                    arrayToEdit: setting.arrayToEdit,
                                    menuHeader: setting.menuHeader
                                }
                            }
                        }
                    ]
            )
        );
        index++;
    }

    showModal(
        {
            title: 'TizenTube Settings',
            subtitle: 'Made by Reis Can (reisxd) with ❤️'
        },
        overlayPanelItemListRenderer(buttons, parameters && parameters.length > 0 ? parameters[0] : 0),
        'tt-settings',
        update
    );
}

export function optionShow(parameters, update) {
    if (update === 'customUI') {
        const option = parameters.options;
        showModal(
            {
                title: option.title,
                subtitle: option.subtitle
            },
            option.content,
            'tt-settings-support',
            false
        );
        return;
    }
    const buttons = [];
    const options = (parameters.options || []).filter(Boolean);

    // Check if this is the legacy sponsorBlockManualSkips (array-based) or new boolean-based options
    const isArrayBasedOptions = parameters.arrayToEdit !== undefined;

    if (isArrayBasedOptions) {
        // Legacy handling for sponsorBlockManualSkips
        const value = configRead(parameters.arrayToEdit);
        for (const option of options) {
            buttons.push(
                buttonItem(
                    { title: option.name, subtitle: option.subtitle },
                    {
                        icon: option.icon ? option.icon : 'CHEVRON_DOWN',
                        secondaryIcon: value.includes(option.value) ? 'CHECK_BOX' : 'CHECK_BOX_OUTLINE_BLANK'
                    },
                    [
                        {
                            setClientSettingEndpoint: {
                                settingDatas: [
                                    {
                                        clientSettingEnum: {
                                            item: parameters.arrayToEdit
                                        },
                                        arrayValue: option.value
                                    }
                                ]
                            }
                        },
                        {
                            customAction: {
                                action: 'OPTIONS_SHOW',
                                parameters: {
                                    options: parameters.options,
                                    selectedIndex: parameters.options.indexOf(option),
                                    update: true,
                                    menuId: parameters.menuId,
                                    arrayToEdit: parameters.arrayToEdit,
                                    menuHeader: parameters.menuHeader
                                }
                            }
                        }
                    ]
                )
            );
        }
    } else {
        let index = 0;
        for (const option of parameters.options) {
            if (!option) continue;
            if (option.compactLinkRenderer) {
                buttons.push(option);
                index++;
                continue;
            }
            const isRadioChoice = option.key !== null && option.key !== undefined;
            const currentVal = configRead(isRadioChoice ? option.key : option.value);
            
            buttons.push(
                buttonItem(
                    { title: option.name, subtitle: option.subtitle },
                    {
                        icon: option.icon ? option.icon : 'CHEVRON_DOWN',
                        secondaryIcon: isRadioChoice ? currentVal === option.value ? 'RADIO_BUTTON_CHECKED' : 'RADIO_BUTTON_UNCHECKED' : option.value === null ? 'CHEVRON_RIGHT' : currentVal ? 'CHECK_BOX' : 'CHECK_BOX_OUTLINE_BLANK'
                    },
                    option.value === null ? [
                        {
                            customAction: {
                                action: 'OPTIONS_SHOW',
                                parameters: {
                                    options: option.options,
                                    selectedIndex: 0,
                                    update: option.options?.title ? 'customUI' : false,
                                    menuId: option.menuId,
                                    arrayToEdit: option.arrayToEdit,
                                    menuHeader: option.menuHeader
                                }
                            }
                        }
                    ] : option.key !== null && option.key !== undefined ? [
                        {
                            setClientSettingEndpoint: {
                                settingDatas: [
                                    {
                                        clientSettingEnum: {
                                            item: option.key
                                        },
                                        stringValue: option.value
                                    }
                                ]
                            }
                        },
                        {
                            customAction: {
                                action: 'OPTIONS_SHOW',
                                parameters: {
                                    options: parameters.options,
                                    selectedIndex: index, // Keep current selection highlighted
                                    update: true, // FORCE UPDATE to refresh the UI
                                    menuId: parameters.menuId,
                                    arrayToEdit: parameters.arrayToEdit,
                                    menuHeader: parameters.menuHeader
                                }
                            }
                        }
                    ] : [
                        {
                            setClientSettingEndpoint: {
                                settingDatas: [
                                    {
                                        clientSettingEnum: {
                                            item: option.value
                                        },
                                        boolValue: !currentVal
                                    }
                                ]
                            }
                        },
                        {
                            customAction: {
                                action: 'OPTIONS_SHOW',
                                parameters: {
                                    options: parameters.options,
                                    selectedIndex: index,
                                    update: true, // FORCE UPDATE
                                    menuId: parameters.menuId,
                                    arrayToEdit: parameters.arrayToEdit,
                                    menuHeader: parameters.menuHeader
                                }
                            }
                        }
                    ]
                )
            );
            index++;
        }
    }

    showModal(parameters.menuHeader ? parameters.menuHeader : 'TizenTube Settings', overlayPanelItemListRenderer(buttons, parameters.selectedIndex), parameters.menuId || 'tt-settings-options', update);
}
