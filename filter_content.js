// -*- Mode: c++; tab-width: 2; indent-tabs-mode: nil; c-basic-offset: 2 -*-
//
// Copyright (C) 2016 Opera Software AS. All rights reserved.
//
// This file is an original work developed by Opera Software AS

'use strict';

const elementClickString = '+element-click(';
const sitekey_tag = 'data-adblockkey';

class FilterContent {
    constructor() {
        this.filteredElements_ = new WeakSet();
        this.observer_ = null;
        this.root_ = null;
        this.selectors_ = new Map();
        this.styles_ = document.createElement('style');
        this.styles_.type = 'text/css';
        this.urls_ = new Map();
        this.elementsToClick_ = new Array();
        this.sitekey_ =
            document.getElementsByTagName('html')[0].getAttribute(sitekey_tag);
        if (this.sitekey_ === null) {
            this.sitekey_ = '';
        }

        opr.contentFilterPrivate.isWhitelisted(whitelisted => {
            if (!whitelisted) {
                this.whenDomReady_().then(() => this.initialize_());
                this.applySelectors_();
            }
        });
    }

    applySelectors_() {
        return new Promise(resolve => {
            opr.contentFilterPrivate.getBlockedSelectors(selectors => {
                if (!Array.isArray(selectors)) {
                    resolve();
                    return;
                }
                selectors.forEach(element => this.getElementClickSelectors_(element));
                let styles = [];
                while (selectors.length) {
                    styles.push(`:root ${selectors.splice(0, 1000).join(', :root ')}`);
                }

                this.styles_.textContent =
                    styles.map(selector => `${selector} { display: none !important; }`)
                    .join('\n');
                resolve();
            });
        });
    }

    fetchSelectors_(element) {
        let selectors = [];
        if (element.id) {
            selectors.push(`#${element.id}`);
        }

        if (element.classList) {
            for (let cl of element.classList) {
                selectors.push(`.${cl}`);
            }
        }

        return selectors;
    }

    filter_() {
        if (!this.root_) {
            return;
        }

        this.filterChildrenIfNeeded_(this.root_);
        this.filterAssetsIfNeeded_(this.root_);
        this.clickElementsIfNeeded_();
    }

    filterAssetsIfNeeded_(root) {
        let assets = root.querySelectorAll('[src]');
        for (let asset of assets) {
            if (this.isUrlFiltered_(asset)) {
                this.hideElement_(asset);
            }
        }
    }

    filterChildrenIfNeeded_(parent) {
        if (parent.querySelectorAll) {
            let children = parent.querySelectorAll('[id], [class]');
            for (let i = 0; i < children.length; i++) {
                this.filterElementIfNeeded_(children[i]);
            }
        }
    }

    filterElementIfNeeded_(element) {
        if (!element) {
            return false;
        }

        if (this.filteredElements_.has(element)) {
            return true;
        }

        if (this.hasForbidenSelectors_(element)) {
            this.hideElement_(element);
            if (element.id) {
                opr.contentFilterPrivate.recordBlockAction(element.id);
            }
            return true;
        }

        return false;
    }

    hasForbidenSelectors_(element, callback) {
        const selectors = this.fetchSelectors_(element);
        const newSelectors = [];
        let selector;
        let value;

        for (let i = 0; i < selectors.length; i++) {
            selector = selectors[i];
            value = this.selectors_.get(selector);
            if (value) {
                return true;
            }

            if (value === undefined) {
                newSelectors.push(selector);
            }
        }

        for (let i = 0; i < newSelectors.length; i++) {
            selector = newSelectors[i];
            value =
                opr.contentFilterPrivate.isElementBlocked(selector, this.sitekey_);
            this.selectors_.set(selector, value);
            if (value) {
                return true;
            }
        }
    }

    hideElement_(element) {
        if (!element) {
            return;
        }

        if (element.style && element.style.getPropertyValue('display') !== 'none') {
            element.style.setProperty('display', 'none', 'important');
        }
        this.filteredElements_.add(element);
    }

    initialize_() {
        opr.contentFilterPrivate.onRulesAvailableInRenderer.addListener(
            (id) => this.onRulesAvailableInRenderer_(id));

        this.root_ = document.body;
        document.head.appendChild(this.styles_);
        this.observer_ = new MutationObserver(
            mutations => setTimeout(() => this.onDocumentChange_(mutations), 0));
        this.observer_.observe(this.root_, {
            attributes: true,
            attributeOldValue: true,
            attributeFilter: ['class', 'id'], // 'style'
            childList: true,
            subtree: true,
        });

        this.root_.addEventListener(
            'error', e => this.onResourceError_(e.target), true);
        opr.contentFilterPrivate.onRulesLoaded.addListener(
            () => this.onRulesLoaded_());

        this.filter_();
    }

    getElementType(tagName) {
        if (tagName === 'IMG') {
            return opr.contentFilterPrivate.ElementType.IMAGE;
        }
        if (tagName === 'IFRAME') {
            return opr.contentFilterPrivate.ElementType.SUB_FRAME;
        }
        return opr.contentFilterPrivate.ElementType.UNKNOWN;
    }

    isUrlFiltered_(element) {
        if (!element || !element.src) {
            return false;
        }
        const url = element.src;
        const element_type = this.getElementType(element.tagName);
        let isBlocked = this.urls_.get(url);
        if (isBlocked === undefined) {
            isBlocked = opr.contentFilterPrivate.isURLBlocked(
                url, element_type, this.sitekey_);
            this.urls_.set(url, isBlocked);
        }

        return isBlocked;
    }

    onDocumentChange_(mutations) {
        for (let record of mutations) {
            let addedNodes = record.addedNodes;
            if (addedNodes) {
                for (let i = 0; i < addedNodes.length; i++) {
                    if (!this.filterElementIfNeeded_(addedNodes[i])) {
                        this.filterChildrenIfNeeded_(addedNodes[i]);
                    }
                }
            }

            if (record.target) {
                this.filterElementIfNeeded_(record.target);
            }
        }
        this.clickElementsIfNeeded_();
    }

    onResourceError_(element) {
        if (this.isUrlFiltered_(element)) {
            this.hideElement_(element);
        }
    }

    onRulesAvailableInRenderer_(id) {
        if (opr.contentFilterPrivate.matchRulesAvailableEventID(id))
            this.onRulesLoaded_();
    }

    onRulesLoaded_() {
        this.filteredElements_ = new WeakSet();
        this.selectors_ = new Map();
        this.urls_ = new Map();
        this.applySelectors_().then(() => this.filter_());
    }

    whenDomReady_() {
        return new Promise(resolve => {
            if (document.readyState !== 'loading') {
                resolve();
            } else {
                document.addEventListener('DOMContentLoaded', () => resolve());
            }
        });
    }

    getElementClickSelectors_(element) {
        let tempElement = element;
        if (tempElement.startsWith(elementClickString)) {
            tempElement = tempElement.slice(elementClickString.length);
            if (tempElement.endsWith(')')) {
                tempElement = tempElement.slice(0, -1);
            }
            this.elementsToClick_.push(tempElement);
        }
    }

    async isContentFilterAdsEnabled_() {
        return new Promise(resolve => {
            opr.contentFilterPrivate.isContentFilterTypeEnabled(
                opr.contentFilterPrivate.ContentFilterType.ADS,
                isBlockingAdsEnabled => {
                    resolve(isBlockingAdsEnabled);
                });
        });
    }

    async clickElementsIfNeeded_() {
        if (!await this.isContentFilterAdsEnabled_()) {
            return;
        }
        for (const element of this.elementsToClick_) {
            const skipButton = document.querySelector(element);
            if (skipButton) {
                skipButton.click();
            }
        }
    }
}

new FilterContent();