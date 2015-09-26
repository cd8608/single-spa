let appLocationToApp = {};
let unhandledRouteHandlers = [];
let mountedApp;
const nativeAddEventListener = window.addEventListener;
const urlLoader = new LoaderPolyfill();
const nativeSystemGlobal = window.System;

window.singlespa = function(element) {
	window.history.pushState(undefined, '', element.getAttribute('href'));
	setTimeout(function() {
		triggerAppChange();
	}, 10);
	return false;
}

export function declareChildApplication(appLocation, activeWhen) {
	if (typeof appLocation !== 'string' || appLocation.length === 0)
		throw new Error(`The first argument must be a non-empty string 'appLocation'`);
	if (typeof activeWhen !== 'function')
		throw new Error(`The second argument must be a function 'activeWhen'`);
	if (appLocationToApp[appLocation])
		throw new Error(`There is already an app declared at location ${appLocation}`);

	appLocationToApp[appLocation] = {
		appLocation: appLocation,
		activeWhen: activeWhen,
		parentApp: mountedApp ? mountedApp.appLocation : null
	};

	triggerAppChange();
}

export function addUnhandledRouteHandler(handler) {
	if (typeof handler !== 'function') {
		throw new Error(`The first argument must be a handler function`);
	}
	unhandledRouteHandlers.push(handler);
}

export function updateApplicationSourceCode(appName) {
	if (!appLocationToApp[appName]) {
		throw new Error(`No such app '${appName}'`);
	}
	let app = appLocationToApp[appName];
	app.lifecycleFunctions.activeApplicationSourceWillUpdate().then(() => {
		//TODO reload the app
		app.lifecycleFunctions.activeApplicationSourceWasUpdated();
	});
}

function loadAppForFirstTime(appLocation) {
	return new Promise(function(resolve, reject) {
		var currentAppSystemGlobal = window.System;
		window.System = nativeSystemGlobal;
		nativeSystemGlobal.import(appLocation).then(function(restOfApp) {
			if (restOfApp.default) {
				restOfApp = restOfApp.default;
			}
			registerApplication(appLocation, restOfApp);
			let app = appLocationToApp[appLocation];
			window.System = currentAppSystemGlobal;
			app.entryWillBeInstalled().then(() => {
				window.System.import(app.entry).then(() => {
					resolve();
				})
			})
		})
	})
}

function registerApplication(appLocation, partialApp) {
	let app = appLocationToApp[appLocation];
	for (propertyName in partialApp) {
		app[propertyName] = partialApp[propertyName];
	}
	app.hashChangeFunctions = [];
	app.popStateFunctions = [];
}

nativeAddEventListener('popstate', triggerAppChange);

function triggerAppChange() {
	let newApp = appForCurrentURL();
	if (!newApp) {
		unhandledRouteHandlers.forEach((handler) => {
			handler(mountedApp);
		});
	}

	if (newApp !== mountedApp) {
		let appWillUnmountPromise = mountedApp ? mountedApp.applicationWillUnmount() : new Promise((resolve) => resolve());

		appWillUnmountPromise.then(function() {
			let appUnmountedPromise = new Promise(function(resolve) {
				if (mountedApp) {
					mountedApp.unmountApplication(mountedApp.containerEl).then(() => {
						finishUnmountingApp(mountedApp);
						resolve();
					});
				} else {
					resolve();
				}
			});
			appUnmountedPromise.then(() => {
				let appLoadedPromise = newApp.entry ? new Promise((resolve) => resolve()) : loadAppForFirstTime(newApp.appLocation);
				appLoadedPromise.then(function() {
					newApp.applicationWillMount().then(function() {
						appWillBeMounted(newApp);
						newApp.mountApplication(newApp.containerEl).then(function() {
							mountedApp = newApp;
						});
					})
				})
			})
		})
	}
}

function appForCurrentURL() {
	let appsForCurrentUrl = [];
	for (let appName in appLocationToApp) {
		let app = appLocationToApp[appName];
		if (app.activeWhen(window.location)) {
			appsForCurrentUrl.push(app);
		}
	}
	switch (appsForCurrentUrl.length) {
		case 0:
			return undefined;
		case 1:
			return appsForCurrentUrl[0];
		default:
			appNames = appsForCurrentUrl.map((app) => app.name);
			throw new Error(`The following applications all claim to own the location ${window.location.href} -- ${appnames.toString()}`)
	}
}

function appWillBeMounted(app) {
	app.hashChangeFunctions.forEach((hashChangeFunction) => {
		nativeAddEventListener('hashchange', hashChangeFunction);
	});
	app.popStateFunctions.forEach((popStateFunction) => {
		nativeAddEventListener('popstate', popStateFunction);
	});
	app.containerEl = document.createElement('div');
	app.containerEl.setAttribute('single-spa-active-app', app.appLocation);
	document.body.appendChild(app.containerEl);
}

function finishUnmountingApp(app) {
	app.hashChangeFunctions.forEach((hashChangeFunction) => {
		window.removeEventListener('hashchange', hashChangeFunction);
	});
	app.popStateFunctions.forEach((popStateFunction) => {
		window.removeEventListener('popstate', popStateFunctions);
	});
	document.body.removeChild(app.containerEl);
}

window.addEventListener = function(name, fn) {
	if (mountedApp) {
		if (name === 'popstate') {
			mountedApp.popStateFunctions.push(fn);
		} else if (name === 'hashchange') {
			mountedApp.hashChangeFunctions.push(fn);
		}
		nativeAddEventListener.apply(this, arguments);
	}
}