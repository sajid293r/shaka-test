/*! @license
 * Shaka Player
 * Copyright 2016 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */


goog.provide('shaka.ui.ResolutionSelection');

goog.require('goog.asserts');
goog.require('shaka.Player');
goog.require('shaka.ui.Controls');
goog.require('shaka.ui.Enums');
goog.require('shaka.ui.Locales');
goog.require('shaka.ui.Localization');
goog.require('shaka.ui.OverflowMenu');
goog.require('shaka.ui.Overlay.TrackLabelFormat');
goog.require('shaka.ui.SettingsMenu');
goog.require('shaka.ui.Utils');
goog.require('shaka.util.Dom');
goog.require('shaka.util.FakeEvent');
goog.require('shaka.util.Functional');
goog.require('shaka.util.MimeUtils');
goog.requireType('shaka.ui.Controls');


/**
 * @extends {shaka.ui.SettingsMenu}
 * @final
 * @export
 */
shaka.ui.ResolutionSelection = class extends shaka.ui.SettingsMenu {
  /**
   * @param {!HTMLElement} parent
   * @param {!shaka.ui.Controls} controls
   */
  constructor(parent, controls) {
    super(parent, controls, shaka.ui.Enums.MaterialDesignIcons.RESOLUTION);

    this.button.classList.add('shaka-resolution-button');
    this.button.classList.add('shaka-tooltip-status');
    this.menu.classList.add('shaka-resolutions');

    this.eventManager.listen(
        this.localization, shaka.ui.Localization.LOCALE_UPDATED, () => {
          this.updateLocalizedStrings_();
        });

    this.eventManager.listen(
        this.localization, shaka.ui.Localization.LOCALE_CHANGED, () => {
          this.updateLocalizedStrings_();
        });


    this.eventManager.listen(this.player, 'loading', () => {
      this.updateResolutionSelection_();
    });

    this.eventManager.listen(this.player, 'variantchanged', () => {
      this.updateResolutionSelection_();
    });

    this.eventManager.listen(this.player, 'trackschanged', () => {
      this.updateResolutionSelection_();
    });

    this.eventManager.listen(this.player, 'abrstatuschanged', () => {
      this.updateResolutionSelection_();
    });

    this.updateResolutionSelection_();
  }


  /** @private */
  updateResolutionSelection_() {
    const TrackLabelFormat = shaka.ui.Overlay.TrackLabelFormat;
    /** @type {!Array<shaka.extern.Track>} */
    let tracks = [];
    // When played with src=, the variant tracks available from
    // player.getVariantTracks() represent languages, not resolutions.
    if (this.player.getLoadMode() != shaka.Player.LoadMode.SRC_EQUALS) {
      tracks = this.player.getVariantTracks();
    }

    // If there is a selected variant track, then we filter out any tracks in
    // a different language.  Then we use those remaining tracks to display the
    // available resolutions.
    const selectedTrack = tracks.find((track) => track.active);
    if (selectedTrack) {
      tracks = tracks.filter((track) => {
        if (track.language != selectedTrack.language) {
          return false;
        }
        if (this.controls.getConfig().showAudioChannelCountVariants &&
            track.channelsCount && selectedTrack.channelsCount &&
            track.channelsCount != selectedTrack.channelsCount) {
          return false;
        }
        const trackLabelFormat = this.controls.getConfig().trackLabelFormat;
        if ((trackLabelFormat == TrackLabelFormat.ROLE ||
            trackLabelFormat == TrackLabelFormat.LANGUAGE_ROLE)) {
          if (JSON.stringify(track.audioRoles) !=
              JSON.stringify(selectedTrack.audioRoles)) {
            return false;
          }
        }
        if (trackLabelFormat == TrackLabelFormat.LABEL &&
            track.label != selectedTrack.label) {
          return false;
        }
        return true;
      });
    }

    // Remove duplicate entries with the same resolution or quality depending
    // on content type.  Pick an arbitrary one.
    if (this.player.isAudioOnly()) {
      tracks = tracks.filter((track, idx) => {
        return tracks.findIndex((t) => t.bandwidth == track.bandwidth) == idx;
      });
    } else {
      const audiosIds = [...new Set(tracks.map((t) => t.audioId))]
          .filter(shaka.util.Functional.isNotNull);
      if (audiosIds.length > 1) {
        tracks = tracks.filter((track, idx) => {
          // Keep the first one with the same height and framerate or bandwidth.
          const otherIdx = tracks.findIndex((t) => {
            let ret = t.height == track.height &&
                t.videoBandwidth == track.videoBandwidth &&
                t.frameRate == track.frameRate &&
                t.hdr == track.hdr &&
                t.videoLayout == track.videoLayout;
            if (ret && this.controls.getConfig().showVideoCodec &&
                t.videoCodec && track.videoCodec) {
              ret = shaka.util.MimeUtils.getNormalizedCodec(t.videoCodec) ==
                  shaka.util.MimeUtils.getNormalizedCodec(track.videoCodec);
            }
            return ret;
          });
          return otherIdx == idx;
        });
      } else {
        tracks = tracks.filter((track, idx) => {
          // Keep the first one with the same height and framerate or bandwidth.
          const otherIdx = tracks.findIndex((t) => {
            let ret = t.height == track.height &&
                t.bandwidth == track.bandwidth &&
                t.frameRate == track.frameRate &&
                t.hdr == track.hdr &&
                t.videoLayout == track.videoLayout;
            if (ret && this.controls.getConfig().showVideoCodec &&
                t.videoCodec && track.videoCodec) {
              ret = shaka.util.MimeUtils.getNormalizedCodec(t.videoCodec) ==
                  shaka.util.MimeUtils.getNormalizedCodec(track.videoCodec);
            }
            return ret;
          });
          return otherIdx == idx;
        });
      }
    }

    // Sort the tracks by height or bandwidth depending on content type.
    if (this.player.isAudioOnly()) {
      tracks.sort((t1, t2) => {
        goog.asserts.assert(t1.bandwidth != null, 'Null bandwidth');
        goog.asserts.assert(t2.bandwidth != null, 'Null bandwidth');
        return t2.bandwidth - t1.bandwidth;
      });
    } else {
      tracks.sort((t1, t2) => {
        if (t2.height == t1.height || t1.height == null || t2.height == null) {
          return t2.bandwidth - t1.bandwidth;
        }
        return t2.height - t1.height;
      });
    }

    // Remove old shaka-resolutions
    // 1. Save the back to menu button
    const backButton = shaka.ui.Utils.getFirstDescendantWithClassName(
        this.menu, 'shaka-back-to-overflow-button');

    // 2. Remove everything
    shaka.util.Dom.removeAllChildren(this.menu);

    // 3. Add the backTo Menu button back
    this.menu.appendChild(backButton);

    const abrEnabled = this.player.getConfiguration().abr.enabled;

    // Add new ones
    for (const track of tracks) {
      const button = shaka.util.Dom.createButton();
      button.classList.add('explicit-resolution');
      this.eventManager.listen(button, 'click',
          () => this.onTrackSelected_(track));

      const span = shaka.util.Dom.createHTMLElement('span');
      if (!this.player.isAudioOnly() && track.height && track.width) {
        span.textContent = this.getResolutionLabel_(track, tracks);
      } else if (track.bandwidth) {
        span.textContent = Math.round(track.bandwidth / 1000) + ' kbits/s';
      } else {
        span.textContent = 'Unknown';
      }
      button.appendChild(span);

      if (!abrEnabled && track == selectedTrack) {
        // If abr is disabled, mark the selected track's resolution.
        button.ariaSelected = 'true';
        button.appendChild(shaka.ui.Utils.checkmarkIcon());
        span.classList.add('shaka-chosen-item');
        this.currentSelection.textContent = span.textContent;
      }
      this.menu.appendChild(button);
    }

    // Add the Auto button
    const autoButton = shaka.util.Dom.createButton();
    autoButton.classList.add('shaka-enable-abr-button');
    this.eventManager.listen(autoButton, 'click', () => {
      const config = {abr: {enabled: true}};
      this.player.configure(config);
      this.updateResolutionSelection_();
    });

    /** @private {!HTMLElement}*/
    this.abrOnSpan_ = shaka.util.Dom.createHTMLElement('span');
    this.abrOnSpan_.classList.add('shaka-auto-span');
    this.abrOnSpan_.textContent =
        this.localization.resolve(shaka.ui.Locales.Ids.AUTO_QUALITY);
    autoButton.appendChild(this.abrOnSpan_);

    // If abr is enabled reflect it by marking 'Auto' as selected.
    if (abrEnabled) {
      autoButton.ariaSelected = 'true';
      autoButton.appendChild(shaka.ui.Utils.checkmarkIcon());

      this.abrOnSpan_.classList.add('shaka-chosen-item');

      this.currentSelection.textContent =
          this.localization.resolve(shaka.ui.Locales.Ids.AUTO_QUALITY);
    }

    this.button.setAttribute('shaka-status', this.currentSelection.textContent);

    this.menu.appendChild(autoButton);
    shaka.ui.Utils.focusOnTheChosenItem(this.menu);
    this.controls.dispatchEvent(
        new shaka.util.FakeEvent('resolutionselectionupdated'));

    this.updateLocalizedStrings_();

    shaka.ui.Utils.setDisplay(this.button, tracks.length > 1);
  }


  /**
   * @param {!shaka.extern.Track} track
   * @param {!Array<!shaka.extern.Track>} tracks
   * @return {string}
   * @private
   */
  getResolutionLabel_(track, tracks) {
    const trackHeight = track.height || 0;
    const trackWidth = track.width || 0;
    let height = trackHeight;
    const aspectRatio = trackWidth / trackHeight;
    if (aspectRatio > (16 / 9)) {
      height = Math.round(trackWidth * 9 / 16);
    }
    let text = height + 'p';
    if (height == 2160 || trackHeight == 2160) {
      text = '4K';
    }
    const frameRates = new Set();
    for (const item of tracks) {
      if (item.frameRate) {
        frameRates.add(Math.round(item.frameRate));
      }
    }
    if (frameRates.size > 1) {
      const frameRate = track.frameRate;
      if (frameRate && (frameRate >= 50 || frameRate <= 20)) {
        text += Math.round(track.frameRate);
      }
    }
    if (track.hdr == 'PQ' || track.hdr == 'HLG') {
      text += ' (HDR)';
    }
    if (track.videoLayout == 'CH-STEREO') {
      text += ' (3D)';
    }
    const basicResolutionComparison = (firstTrack, secondTrack) => {
      return firstTrack != secondTrack &&
          firstTrack.height == secondTrack.height &&
          firstTrack.hdr == secondTrack.hdr &&
          Math.round(firstTrack.frameRate || 0) ==
          Math.round(secondTrack.frameRate || 0);
    };
    const hasDuplicateResolution = tracks.some((otherTrack) => {
      return basicResolutionComparison(track, otherTrack);
    });
    if (hasDuplicateResolution) {
      const hasDuplicateBandwidth = tracks.some((otherTrack) => {
        return basicResolutionComparison(track, otherTrack) &&
            (otherTrack.videoBandwidth || otherTrack.bandwidth) ==
            (track.videoBandwidth || track.bandwidth);
      });
      if (!hasDuplicateBandwidth) {
        const bandwidth = track.videoBandwidth || track.bandwidth;
        text += ' (' + Math.round(bandwidth / 1000) + ' kbits/s)';
      }

      if (this.controls.getConfig().showVideoCodec) {
        const getVideoCodecName = (videoCodec) => {
          let name = '';
          if (videoCodec) {
            const codec = shaka.util.MimeUtils.getNormalizedCodec(videoCodec);
            if (codec.startsWith('dovi-')) {
              name = 'Dolby Vision';
            } else {
              name = codec.toUpperCase();
            }
          }
          return name ? ' ' + name : name;
        };
        const hasDuplicateCodec = tracks.some((otherTrack) => {
          return basicResolutionComparison(track, otherTrack) &&
              getVideoCodecName(otherTrack.videoCodec) !=
              getVideoCodecName(track.videoCodec);
        });
        if (hasDuplicateCodec) {
          text += getVideoCodecName(track.videoCodec);
        }
      }
    }
    return text;
  }


  /**
   * @param {!shaka.extern.Track} track
   * @private
   */
  onTrackSelected_(track) {
    // Disable abr manager before changing tracks.
    const config = {abr: {enabled: false}};
    this.player.configure(config);
    const clearBuffer = this.controls.getConfig().clearBufferOnQualityChange;
    this.player.selectVariantTrack(track, clearBuffer);
  }


  /**
   * @private
   */
  updateLocalizedStrings_() {
    const LocIds = shaka.ui.Locales.Ids;
    const locId = this.player.isAudioOnly() ?
        LocIds.QUALITY : LocIds.RESOLUTION;

    this.button.ariaLabel = this.localization.resolve(locId);
    this.backButton.ariaLabel = this.localization.resolve(locId);
    this.backSpan.textContent =
        this.localization.resolve(locId);
    this.nameSpan.textContent =
        this.localization.resolve(locId);
    this.abrOnSpan_.textContent =
        this.localization.resolve(LocIds.AUTO_QUALITY);

    if (this.player.getConfiguration().abr.enabled) {
      this.currentSelection.textContent =
          this.localization.resolve(shaka.ui.Locales.Ids.AUTO_QUALITY);
    }
  }
};


/**
 * @implements {shaka.extern.IUIElement.Factory}
 * @final
 */
shaka.ui.ResolutionSelection.Factory = class {
  /** @override */
  create(rootElement, controls) {
    return new shaka.ui.ResolutionSelection(rootElement, controls);
  }
};

shaka.ui.OverflowMenu.registerElement(
    'quality', new shaka.ui.ResolutionSelection.Factory());

shaka.ui.Controls.registerElement(
    'quality', new shaka.ui.ResolutionSelection.Factory());
