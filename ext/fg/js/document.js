/*
 * Copyright (C) 2016-2017  Alex Yatskov <alex@foosoft.net>
 * Author: Alex Yatskov <alex@foosoft.net>
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU General Public License as published by
 * the Free Software Foundation, either version 3 of the License, or
 * (at your option) any later version.
 *
 * This program is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
 * GNU General Public License for more details.
 *
 * You should have received a copy of the GNU General Public License
 * along with this program.  If not, see <http://www.gnu.org/licenses/>.
 */


function docOffsetCalc(element) {
    const scrollTop = window.pageYOffset || document.documentElement.scrollTop || document.body.scrollTop;
    const scrollLeft = window.pageXOffset || document.documentElement.scrollLeft || document.body.scrollLeft;

    const clientTop = document.documentElement.clientTop || document.body.clientTop || 0;
    const clientLeft = document.documentElement.clientLeft || document.body.clientLeft || 0;

    const rect = element.getBoundingClientRect();
    const top  = Math.round(rect.top +  scrollTop - clientTop);
    const left = Math.round(rect.left + scrollLeft - clientLeft);

    return {top, left};
}

function docImposterCreate(element) {
    const styleProps = window.getComputedStyle(element);
    const stylePairs = [];
    for (const key of styleProps) {
        stylePairs.push(`${key}: ${styleProps[key]};`);
    }

    const offset = docOffsetCalc(element);
    const imposter = document.createElement('div');
    imposter.className = 'yomichan-imposter';
    imposter.innerText = element.value;
    imposter.style.cssText = stylePairs.join('\n');
    imposter.style.position = 'absolute';
    imposter.style.top = `${offset.top}px`;
    imposter.style.left = `${offset.left}px`;
    imposter.style.opacity = 0;
    imposter.style.zIndex = 2147483646;
    if (element.nodeName === 'TEXTAREA' && styleProps.overflow === 'visible') {
        imposter.style.overflow = 'auto';
    }

    document.body.appendChild(imposter);
    imposter.scrollTop = element.scrollTop;
    imposter.scrollLeft = element.scrollLeft;

    return imposter;
}

function docImposterDestroy() {
    for (const element of document.getElementsByClassName('yomichan-imposter')) {
        element.parentNode.removeChild(element);
    }
}

function docRangeFromPoint(point) {
    const element = document.elementFromPoint(point.x, point.y);
    let imposter = null;
    if (element) {
        switch (element.nodeName) {
            case 'IMG':
            case 'BUTTON':
                return new TextSourceElement(element);
            case 'INPUT':
            case 'TEXTAREA':
                imposter = docImposterCreate(element);
                break;
        }
    }

    const range = document.caretRangeFromPoint(point.x, point.y);
    if (imposter !== null) {
        imposter.style.zIndex = -2147483646;
    }

    return range !== null && isPointInRange(point, range) ? new TextSourceRange(range) : null;
}

function docSentenceExtract(source, extent) {
    const quotesFwd = {'「': '」', '『': '』', "'": "'", '"': '"'};
    const quotesBwd = {'」': '「', '』': '『', "'": "'", '"': '"'};
    const terminators = '…。．.？?！!';

    const sourceLocal = source.clone();
    const position = sourceLocal.setStartOffset(extent);
    sourceLocal.setEndOffset(position + extent);
    const content = sourceLocal.text();

    let quoteStack = [];

    let startPos = 0;
    for (let i = position; i >= startPos; --i) {
        const c = content[i];

        if (c === '\n') {
            startPos = i + 1;
            break;
        }

        if (quoteStack.length === 0 && (terminators.includes(c) || c in quotesFwd)) {
            startPos = i + 1;
            break;
        }

        if (quoteStack.length > 0 && c === quoteStack[0]) {
            quoteStack.pop();
        } else if (c in quotesBwd) {
            quoteStack = [quotesBwd[c]].concat(quoteStack);
        }
    }

    quoteStack = [];

    let endPos = content.length;
    for (let i = position; i <= endPos; ++i) {
        const c = content[i];

        if (c === '\n') {
            endPos = i + 1;
            break;
        }

        if (quoteStack.length === 0) {
            if (terminators.includes(c)) {
                endPos = i + 1;
                break;
            }
            else if (c in quotesBwd) {
                endPos = i;
                break;
            }
        }

        if (quoteStack.length > 0 && c === quoteStack[0]) {
            quoteStack.pop();
        } else if (c in quotesFwd) {
            quoteStack = [quotesFwd[c]].concat(quoteStack);
        }
    }

    const text = content.substring(startPos, endPos);
    const padding = text.length - text.replace(/^\s+/, '').length;

    return {
        text: text.trim(),
        offset: position - startPos - padding
    };
}

function isPointInRange(point, range) {
    // Scan forward
    const nodePre = range.endContainer;
    const offsetPre = range.endOffset;
    try {
        const {node, offset} = TextSourceRange.seekForward(range.endContainer, range.endOffset, 1);
        range.setEnd(node, offset);

        if (isPointInAnyRect(point, range.getClientRects())) {
            return true;
        }
    } finally {
        range.setEnd(nodePre, offsetPre);
    }

    // Scan backward
    const {node, offset} = TextSourceRange.seekBackward(range.startContainer, range.startOffset, 1);
    range.setStart(node, offset);

    if (isPointInAnyRect(point, range.getClientRects())) {
        // This purposefully leaves the starting offset as modified and sets teh range length to 0.
        range.setEnd(node, offset);
        return true;
    }

    // No match
    return false;
}

function isPointInAnyRect(point, rects) {
    for (const rect of rects) {
        if (isPointInRect(point, rect)) {
            return true;
        }
    }
    return false;
}

function isPointInRect(point, rect) {
    return (
        point.x >= rect.left && point.x < rect.right &&
        point.y >= rect.top && point.y < rect.bottom);
}

if (typeof document.caretRangeFromPoint !== 'function') {
    document.caretRangeFromPoint = (x, y) => {
        const position = document.caretPositionFromPoint(x, y);
        if (position && position.offsetNode && position.offsetNode.nodeType === Node.TEXT_NODE) {
            const range = document.createRange();
            range.setStart(position.offsetNode, position.offset);
            range.setEnd(position.offsetNode, position.offset);
            return range;
        }
        return null;
    };
}
