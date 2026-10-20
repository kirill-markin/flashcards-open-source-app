/** A browser under automation control, Playwright included; decided once per page load. */
export const isAutomationRun: boolean = navigator.webdriver === true;
