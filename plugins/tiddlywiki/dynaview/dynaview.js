/*\
title: $:/plugins/tiddlywiki/dynaview/dynaview.js
type: application/javascript
module-type: startup

Zoom everything

\*/
(function(){

/*jslint node: true, browser: true */
/*global $tw: false */
"use strict";

// Export name and synchronous status
exports.name = "dynaview";
exports.platforms = ["browser"];
exports.before = ["story"];
exports.synchronous = true;

var isWaitingForAnimationFrame = 0, // Bitmask:
	ANIM_FRAME_CAUSED_BY_LOAD = 1, // Animation frame was requested because of page load
	ANIM_FRAME_CAUSED_BY_SCROLL = 2, // Animation frame was requested because of page scroll
	ANIM_FRAME_CAUSED_BY_RESIZE = 4; // Animation frame was requested because of window resize

var LOCAL_STORAGE_KEY_PREFIX = "tw5-dynaview-scroll-position#";

var hasRestoredScrollPosition = false;

exports.startup = function() {
	var topmost = null, lastScrollY;
	$tw.boot.disableStartupNavigation = true;
	window.addEventListener("load",onLoad,false);
	window.addEventListener("scroll",onScroll,false);
	window.addEventListener("resize",onResize,false);
	$tw.hooks.addHook("th-page-refreshing",function() {
		if(!hasRestoredScrollPosition) {
			topmost = restoreScrollPosition();
		} else if(shouldPreserveScrollPosition()) {
			topmost = findTopmostTiddler();
		}
		lastScrollY = window.scrollY;
	});
	$tw.hooks.addHook("th-page-refreshed",function() {
		if(lastScrollY === window.scrollY) { // Don't do scroll anchoring if the scroll position got changed
			if(shouldPreserveScrollPosition() || !hasRestoredScrollPosition) {
				scrollToTiddler(topmost);
				hasRestoredScrollPosition = true;
			}
		}
		updateAddressBar();
		saveScrollPosition();
		checkVisibility();
		saveViewportDimensions();
	});
};

function onLoad(event) {
	if(!isWaitingForAnimationFrame) {
		window.requestAnimationFrame(worker);
	}
	isWaitingForAnimationFrame |= ANIM_FRAME_CAUSED_BY_LOAD;
}

function onScroll(event) {
	if(!isWaitingForAnimationFrame) {
		window.requestAnimationFrame(worker);
	}
	isWaitingForAnimationFrame |= ANIM_FRAME_CAUSED_BY_SCROLL;
}

function onResize(event) {
	if(!isWaitingForAnimationFrame) {
		window.requestAnimationFrame(worker);
	}
	isWaitingForAnimationFrame |= ANIM_FRAME_CAUSED_BY_RESIZE;
}

function worker() {
	if(isWaitingForAnimationFrame & (ANIM_FRAME_CAUSED_BY_RESIZE | ANIM_FRAME_CAUSED_BY_LOAD)) {
		saveViewportDimensions();
	}
	setZoomClasses();
	updateAddressBar();
	saveScrollPosition();
	checkVisibility();
	isWaitingForAnimationFrame = 0;
}

function setZoomClasses() {
	var zoomFactor = document.body.scrollWidth / window.innerWidth,
		classList = document.body.classList;
	classList.add("tc-dynaview");
	classList.toggle("tc-dynaview-zoom-factor-1",zoomFactor <= 2);
	classList.toggle("tc-dynaview-zoom-factor-1-and-above",zoomFactor >= 1);
	classList.toggle("tc-dynaview-zoom-factor-1a-and-above",zoomFactor >= 1.14);
	classList.toggle("tc-dynaview-zoom-factor-1b-and-above",zoomFactor >= 1.33);
	classList.toggle("tc-dynaview-zoom-factor-1c-and-above",zoomFactor >= 1.6);
	classList.toggle("tc-dynaview-zoom-factor-2",zoomFactor >= 2 && zoomFactor <= 3);
	classList.toggle("tc-dynaview-zoom-factor-2-and-above",zoomFactor >= 2);
	classList.toggle("tc-dynaview-zoom-factor-2a-and-above",zoomFactor >= 2.66);
	classList.toggle("tc-dynaview-zoom-factor-3",zoomFactor >= 3 && zoomFactor <= 4);
	classList.toggle("tc-dynaview-zoom-factor-3-and-above",zoomFactor >= 3);
	classList.toggle("tc-dynaview-zoom-factor-4",zoomFactor >= 4);
	classList.toggle("tc-dynaview-zoom-factor-4-and-above",zoomFactor >= 4);
}

function checkVisibility() {
	var elements = document.querySelectorAll(".tc-dynaview-set-tiddler-when-visible");
	$tw.utils.each(elements,function(element) {
		// Bail if we've already triggered this element and we're not unsetting a tiddler when this element leaves the viewport
		if(element.getAttribute("data-dynaview-has-triggered") === "true" && !element.hasAttribute("data-dynaview-unset-tiddler")) {
			return;
		}
		// Calculate whether the element is visible
		var elementRect = element.getBoundingClientRect(),
			viewportWidth = window.innerWidth || document.documentElement.clientWidth,
			viewportHeight = window.innerHeight || document.documentElement.clientHeight,
			viewportRect = {
				left: 0,
				right: viewportWidth,
				top: 0,
				bottom: viewportHeight
			},
			tiddler,
			value;
		if(element.classList.contains("tc-dynaview-expand-viewport")) {
			viewportRect.left -= viewportWidth;
			viewportRect.right += viewportWidth;
			viewportRect.top -= viewportHeight;
			viewportRect.bottom += viewportHeight;
		}
		if(elementRect.left > viewportRect.right || 
			elementRect.right < viewportRect.left || 
			elementRect.top > viewportRect.bottom ||
			elementRect.bottom < viewportRect.top) {
			// Element is not visible
			// Set the unset tiddler if required and this element has previously been triggered
			if(element.getAttribute("data-dynaview-has-triggered") === "true" && element.hasAttribute("data-dynaview-unset-tiddler")) {
				tiddler = element.getAttribute("data-dynaview-unset-tiddler");
				value = element.getAttribute("data-dynaview-unset-value") || "";
				if(tiddler && $tw.wiki.getTiddlerText(tiddler) !== value) {
					$tw.wiki.addTiddler(new $tw.Tiddler({title: tiddler, text: value}));
				}
				element.setAttribute("data-dynaview-has-triggered","false");				
			}
		} else {
			// Element is visible
			tiddler = element.getAttribute("data-dynaview-set-tiddler");
			value = element.getAttribute("data-dynaview-set-value") || "";
			if(tiddler && $tw.wiki.getTiddlerText(tiddler) !== value) {
				$tw.wiki.addTiddler(new $tw.Tiddler({title: tiddler, text: value}));
			}
			element.setAttribute("data-dynaview-has-triggered","true");
		}
	});
}

function updateAddressBar() {
	if($tw.wiki.getTiddlerText("$:/config/DynaView/UpdateAddressBar") === "yes") {
		var top = findTopmostTiddler();
		if(top.element) {
			var hash = "#" + encodeURIComponent(top.title) + ":" + encodeURIComponent("[list[$:/StoryList]]");
			if(title && $tw.locationHash !== hash) {
				$tw.locationHash = hash;
				window.location.hash = hash;			
			}
		}
	}
}

function saveScrollPosition() {
	if(hasRestoredScrollPosition && $tw.wiki.getTiddlerText("$:/config/DynaView/RestoreScrollPositionAtStartup") === "yes") {
		var top = findTopmostTiddler();
		if(top.element) {
			try {
				window.localStorage.setItem(LOCAL_STORAGE_KEY_PREFIX + window.location.pathname,JSON.stringify({
					title: top.title,
					offset: top.offset
				}));
			} catch(e) {
				console.log("Error setting local storage",e)
			}
		}
	}
}

function restoreScrollPosition() {
	var str = window.localStorage.getItem(LOCAL_STORAGE_KEY_PREFIX + window.location.pathname),
		json;
	if(str) {
		try {
			json = JSON.parse(str);
		} catch(e) {
			// Ignore errors
		};
	}
	return json;
}

/*
tiddlerDetails: {title: <title of tiddler to scroll to>, offset: <offset in pixels from the top of the tiddler>}
*/
function scrollToTiddler(tiddlerDetails) {
	if(!$tw.pageScroller.isScrolling() && tiddlerDetails) {
		var elements = document.querySelectorAll(".tc-tiddler-frame[data-tiddler-title]"),
			topmostTiddlerElement = null;
		$tw.utils.each(elements,function(element) {
			if(element.getAttribute("data-tiddler-title") === tiddlerDetails.title) {
				topmostTiddlerElement = element;
			}
		});
		if(topmostTiddlerElement) {
			var rect = topmostTiddlerElement.getBoundingClientRect(),
				scrollY = Math.round(window.scrollY + rect.top + tiddlerDetails.offset);
			if(scrollY !== window.scrollY) {
				window.scrollTo(window.scrollX,scrollY);					
			}
		}
	}
}

function shouldPreserveScrollPosition() {
	return $tw.wiki.getTiddlerText("$:/config/DynaView/PreserveScrollPosition") === "yes";
}

function findTopmostTiddler() {
	var elements = document.querySelectorAll(".tc-tiddler-frame[data-tiddler-title]"),
		topmostElement = null,
		topmostElementTop = 1 * 1000 * 1000;
	$tw.utils.each(elements,function(element) {
		// Check if the element is visible
		var elementRect = element.getBoundingClientRect();
		if((elementRect.top < topmostElementTop) && (elementRect.bottom > 0)) {
			topmostElement = element;
			topmostElementTop = elementRect.top;
		}
	});
	return {
		element: topmostElement,
		offset: -topmostElementTop,
		title: topmostElement.getAttribute("data-tiddler-title")
	};
}

var previousViewportWidth, previousViewportHeight;

function saveViewportDimensions() {
	var viewportWidth = window.innerWidth || document.documentElement.clientWidth,
		viewportHeight = window.innerHeight || document.documentElement.clientHeight;
	if(document.querySelector(".tc-dynaview-request-refresh-on-resize")) {
		if(previousViewportWidth !== viewportWidth || previousViewportHeight !== viewportHeight) {
			var count = parseInt($tw.wiki.getTiddlerText("$:/state/DynaView/ViewportDimensions/ResizeCount","0"),10) || 0;
			$tw.wiki.addTiddler(new $tw.Tiddler({title: "$:/state/DynaView/ViewportDimensions/ResizeCount", text: (count + 1) + ""}));
			previousViewportWidth = viewportWidth;
			previousViewportHeight = viewportHeight;
		}
	}
	if($tw.wiki.getTiddlerText("$:/config/DynaView/ViewportDimensions") === "yes") {
		if($tw.wiki.getTiddlerText("$:/state/DynaView/ViewportDimensions/Width") !== viewportWidth.toString()) {
			$tw.wiki.setText("$:/state/DynaView/ViewportDimensions/Width",undefined,undefined,viewportWidth.toString(),undefined);
		}
		if($tw.wiki.getTiddlerText("$:/state/DynaView/ViewportDimensions/Height") !== viewportHeight.toString()) {
			$tw.wiki.setText("$:/state/DynaView/ViewportDimensions/Height",undefined,undefined,viewportHeight.toString(),undefined);
		}
	}
}

})();
