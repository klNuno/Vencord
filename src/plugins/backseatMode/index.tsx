/*
 * Vencord, a Discord client mod
 * Copyright (c) 2024 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import "./style.css";

import * as DataStore from "@api/DataStore";
import { definePluginSettings } from "@api/Settings";
import { Devs } from "@utils/constants";
import definePlugin, { OptionType } from "@utils/types";
import { findByPropsLazy } from "@webpack";
import { SelectedChannelStore, UserStore, VoiceStateStore } from "@webpack/common";

const MediaEngineStore = findByPropsLazy("getMediaEngine");

const settings = definePluginSettings({
    volume: {
        type: OptionType.SLIDER,
        description: "Volume when backseat mode is active",
        markers: [0, 10, 20, 30, 50, 60, 70, 80, 90, 100],
        default: 20,
        stickToMarkers: true
    },
    disableOnUnmute: {
        type: OptionType.BOOLEAN,
        description: "Disable backseat mode when you unmute yourself",
        default: false
    }
});

interface BackseatModeState {
    isActive: boolean;
    originalVolume: number;
    lastVoiceChannelId: string | null;
    wasMuted: boolean;
}

const state: BackseatModeState = {
    isActive: false,
    originalVolume: 100,
    lastVoiceChannelId: null,
    wasMuted: false
};

const DATASTORE_KEY = "BackseatMode_savedVolume";

async function loadSavedVolume() {
    const saved = await DataStore.get<number>(DATASTORE_KEY);
    if (saved !== undefined && saved !== null) {
        state.originalVolume = saved;
    }
}

async function saveOriginalVolume(volume: number) {
    state.originalVolume = volume;
    await DataStore.set(DATASTORE_KEY, volume);
}

async function clearSavedVolume() {
    await DataStore.del(DATASTORE_KEY);
}

function updateButtonVisual() {
    document.querySelectorAll('button[aria-label*="eafen"]').forEach((button: Element) => {
        (button as HTMLElement).classList.toggle("vc-backseat-active", state.isActive);
    });
}

async function disableBackseatMode() {
    if (!state.isActive) return;

    const mediaEngine = MediaEngineStore.getMediaEngine();
    mediaEngine.setOutputVolume(state.originalVolume);
    state.isActive = false;
    state.lastVoiceChannelId = null;
    state.wasMuted = false;
    updateButtonVisual();
    await clearSavedVolume();
}

async function enableBackseatMode() {
    if (state.isActive) return;

    // cannot activate if not in voice channel
    const chanId = SelectedChannelStore.getVoiceChannelId();
    if (!chanId) {
        return;
    }

    const currentVolume = MediaEngineStore.getOutputVolume();
    await saveOriginalVolume(currentVolume);

    const mediaEngine = MediaEngineStore.getMediaEngine();
    mediaEngine.setOutputVolume(settings.store.volume);
    state.isActive = true;
    state.lastVoiceChannelId = chanId;

    // initialize mute state
    const voiceState = VoiceStateStore.getVoiceStateForChannel(chanId);
    state.wasMuted = !!(voiceState?.mute || voiceState?.selfMute);

    updateButtonVisual();
}

async function toggleBackseatMode() {
    if (state.isActive) {
        await disableBackseatMode();
    } else {
        await enableBackseatMode();
    }
}

function handleAuxClick(e: MouseEvent) {
    if (e.button !== 1) return;

    const target = e.target as HTMLElement;
    const button = target.closest('button[aria-label*="eafen"]');

    if (button) {
        e.preventDefault();
        e.stopPropagation();
        toggleBackseatMode();
    }
}

export default definePlugin({
    name: "BackseatMode",
    description: "Lower output volume with middle-click on deafen button",
    authors: [Devs.meetsu],
    settings,

    flux: {
        VOICE_STATE_UPDATES({ voiceStates }: { voiceStates: any[]; }) {
            const myId = UserStore.getCurrentUser().id;
            const myVoiceState = voiceStates.find(vs => vs.userId === myId);

            if (!myVoiceState) return;

            if (settings.store.disableOnUnmute && state.isActive) {
                const currentlyMuted = !!(myVoiceState.mute || myVoiceState.selfMute);

                // mute then unmute turns backseat mode off
                if (state.wasMuted && !currentlyMuted) {
                    disableBackseatMode();
                    return;
                }

                // update mute state
                state.wasMuted = currentlyMuted;
            }

            if (!state.isActive) return;

            // disable when

            // leaving voice channel
            if (!myVoiceState.channelId) {
                disableBackseatMode();
                return;
            }

            // switching voice channel
            if (state.lastVoiceChannelId && myVoiceState.channelId !== state.lastVoiceChannelId) {
                disableBackseatMode();
                return;
            }

            // when deafening
            if (myVoiceState.deaf || myVoiceState.selfDeaf) {
                disableBackseatMode();
                return;
            }
        }
    },

    async start() {
        state.isActive = false;
        state.lastVoiceChannelId = null;
        state.wasMuted = false;

        await loadSavedVolume();

        const currentVolume = MediaEngineStore.getOutputVolume();
        const backseatVolume = settings.store.volume;

        // restore volume if Discord crashed while backseat mode was active, or pc blew up :c
        if (currentVolume === backseatVolume && state.originalVolume !== backseatVolume) {
            MediaEngineStore.getMediaEngine().setOutputVolume(state.originalVolume);
            await clearSavedVolume();
        }

        document.addEventListener("auxclick", handleAuxClick, true);
    },

    async stop() {
        await disableBackseatMode();
        document.removeEventListener("auxclick", handleAuxClick, true);
    }
});
