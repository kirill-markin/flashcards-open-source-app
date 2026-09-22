import { useEffect, useRef, useState, type KeyboardEvent as ReactKeyboardEvent, type ReactElement } from "react";
import { AnchoredFloatingOverlay, useAnchoredFloatingOutsidePointerDismiss } from "../../floating";
import { autoLocalePreference, supportedLocales, type Locale, type LocalePreference, useI18n } from "../../i18n";
import { localeDisplayNames, matchesLocaleSearch } from "../../i18n/localeDisplayNames";

const LANGUAGE_PICKER_LISTBOX_ID = "settings-language-listbox";
const LANGUAGE_PICKER_VALUE_ID = "settings-language-preference-value";
const LANGUAGE_PICKER_OFFSET_PX = 10;
const LANGUAGE_PICKER_VIEWPORT_PADDING_PX = 16;
const LANGUAGE_PICKER_MAX_HEIGHT_PX = 420;
const LANGUAGE_PICKER_MINIMUM_WIDTH = { kind: "reference" } as const;

function LanguagePickerCheckIcon(): ReactElement {
  return (
    <svg className="review-filter-menu-item-icon" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path
        d="M20 6L9 17L4 12"
        stroke="currentColor"
        strokeWidth="2.2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function LanguagePickerChevronIcon(): ReactElement {
  return (
    <svg className="review-filter-trigger-chevron" viewBox="0 0 18 18" fill="none" aria-hidden="true">
      <path
        d="M4.5 6.75L9 11.25L13.5 6.75"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function LocaleName(props: Readonly<{ locale: Locale; secondaryClassName: string }>): ReactElement {
  const { nativeName, englishName } = localeDisplayNames[props.locale];

  return (
    <>
      <span lang={props.locale}>{nativeName}</span>
      {englishName === nativeName ? null : (
        <>
          {" "}
          <span className={props.secondaryClassName}>{englishName}</span>
        </>
      )}
    </>
  );
}

function toLanguagePickerOptionId(localePreference: LocalePreference): string {
  return `${LANGUAGE_PICKER_LISTBOX_ID}-option-${localePreference}`;
}

function resolveActiveLocalePreference(
  visibleOptions: ReadonlyArray<LocalePreference>,
  visibleLocales: ReadonlyArray<Locale>,
  isSearchActive: boolean,
  activeLocalePreference: LocalePreference | null,
  selectedLocalePreference: LocalePreference,
): LocalePreference {
  if (activeLocalePreference !== null && visibleOptions.includes(activeLocalePreference)) {
    return activeLocalePreference;
  }

  if (selectedLocalePreference !== autoLocalePreference && visibleLocales.includes(selectedLocalePreference)) {
    return selectedLocalePreference;
  }

  // A query that hides the selected language highlights its first match, so Enter picks a real result;
  // "Automatic" is pinned and never filtered, so it stays the fallback for an empty query or no matches.
  const firstMatchingLocale = isSearchActive ? visibleLocales[0] : undefined;
  return firstMatchingLocale ?? autoLocalePreference;
}

function findAdjacentLocalePreference(
  visibleOptions: ReadonlyArray<LocalePreference>,
  currentLocalePreference: LocalePreference,
  direction: -1 | 1,
): LocalePreference {
  const currentIndex = visibleOptions.indexOf(currentLocalePreference);
  const nextIndex = (currentIndex + direction + visibleOptions.length) % visibleOptions.length;
  const nextLocalePreference = visibleOptions[nextIndex];
  if (nextLocalePreference === undefined) {
    throw new Error(`Language picker option index out of range: ${nextIndex}`);
  }

  return nextLocalePreference;
}

function isComboboxComposing(event: ReactKeyboardEvent<HTMLInputElement>): boolean {
  return event.nativeEvent.isComposing || event.nativeEvent.keyCode === 229;
}

function preventOptionPointerFocus(event: React.PointerEvent<HTMLDivElement>): void {
  event.preventDefault();
}

function optionClassName(isSelected: boolean, isActive: boolean): string {
  const classNames = ["review-filter-menu-entry"];
  if (isSelected) {
    classNames.push("review-filter-menu-entry-active");
  }

  if (isActive) {
    classNames.push("review-filter-menu-entry-keyboard-active");
  }

  return classNames.join(" ");
}

export function LanguagePicker(): ReactElement {
  const { localePreference, setLocalePreference, t } = useI18n();
  const [isOpen, setIsOpen] = useState<boolean>(false);
  const [searchText, setSearchText] = useState<string>("");
  const [activeLocalePreference, setActiveLocalePreference] = useState<LocalePreference | null>(null);
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const menuRef = useRef<HTMLDivElement | null>(null);
  const searchInputRef = useRef<HTMLInputElement | null>(null);
  const visibleLocales = supportedLocales.filter((supportedLocale) => matchesLocaleSearch(supportedLocale, searchText));
  const visibleOptions: ReadonlyArray<LocalePreference> = [autoLocalePreference, ...visibleLocales];
  const resolvedActiveLocalePreference = resolveActiveLocalePreference(
    visibleOptions,
    visibleLocales,
    searchText.trim() !== "",
    activeLocalePreference,
    localePreference,
  );
  const activeOptionId = toLanguagePickerOptionId(resolvedActiveLocalePreference);

  useAnchoredFloatingOutsidePointerDismiss({
    triggerRef,
    overlayRef: menuRef,
    enabled: isOpen,
    onClose: handleClose,
  });

  useEffect(() => {
    if (!isOpen) {
      return;
    }

    searchInputRef.current?.focus();
  }, [isOpen]);

  useEffect(() => {
    if (!isOpen) {
      return;
    }

    const activeOptionElement = document.getElementById(activeOptionId);
    if (activeOptionElement instanceof HTMLElement && typeof activeOptionElement.scrollIntoView === "function") {
      activeOptionElement.scrollIntoView({ block: "nearest" });
    }
  }, [activeOptionId, isOpen]);

  useEffect(() => {
    if (!isOpen) {
      return;
    }

    function handleKeyDown(event: KeyboardEvent): void {
      if (event.key === "Escape") {
        closeAndFocusTrigger();
      }
    }

    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [isOpen]);

  function handleClose(): void {
    setSearchText("");
    setActiveLocalePreference(null);
    setIsOpen(false);
  }

  function closeAndFocusTrigger(): void {
    handleClose();
    triggerRef.current?.focus();
  }

  function handleToggle(): void {
    if (isOpen) {
      handleClose();
      return;
    }

    setIsOpen(true);
  }

  function handleSelect(nextLocalePreference: LocalePreference): void {
    setLocalePreference(nextLocalePreference);
    closeAndFocusTrigger();
  }

  function handleComboboxKeyDown(event: ReactKeyboardEvent<HTMLInputElement>): void {
    if (isComboboxComposing(event)) {
      return;
    }

    if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      closeAndFocusTrigger();
      return;
    }

    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      event.stopPropagation();
      setActiveLocalePreference(
        findAdjacentLocalePreference(visibleOptions, resolvedActiveLocalePreference, event.key === "ArrowDown" ? 1 : -1),
      );
      return;
    }

    if (event.key === "Enter") {
      event.preventDefault();
      event.stopPropagation();
      handleSelect(resolvedActiveLocalePreference);
    }
  }

  return (
    <>
      <button
        ref={triggerRef}
        className={`ghost-btn review-filter-trigger settings-language-picker-trigger${isOpen ? " review-filter-trigger-open" : ""}`}
        type="button"
        aria-expanded={isOpen}
        aria-controls={isOpen ? LANGUAGE_PICKER_LISTBOX_ID : undefined}
        aria-haspopup="listbox"
        aria-label={t("locale.picker.openAriaLabel")}
        aria-describedby={LANGUAGE_PICKER_VALUE_ID}
        onClick={handleToggle}
        data-testid="settings-language-preference-select"
      >
        <span id={LANGUAGE_PICKER_VALUE_ID} className="review-filter-trigger-value">
          {localePreference === autoLocalePreference ? t("locale.preferenceAuto") : (
            <LocaleName locale={localePreference} secondaryClassName="settings-language-picker-trigger-secondary" />
          )}
        </span>
        <LanguagePickerChevronIcon />
      </button>
      <AnchoredFloatingOverlay
        isOpen={isOpen}
        referenceRef={triggerRef}
        floatingRef={menuRef}
        placement="bottom-start"
        viewportPaddingPx={LANGUAGE_PICKER_VIEWPORT_PADDING_PX}
        offsetPx={LANGUAGE_PICKER_OFFSET_PX}
        minimumWidth={LANGUAGE_PICKER_MINIMUM_WIDTH}
        maxWidthPx={null}
        maxHeightPx={LANGUAGE_PICKER_MAX_HEIGHT_PX}
        className="review-filter-menu settings-language-picker-menu"
        id={null}
        role={null}
        ariaLabel={null}
        ariaLabelledBy={null}
        ariaDescribedBy={null}
        ariaModal={null}
      >
        <label className="review-filter-search-field">
          <span className="review-filter-search-label">{t("locale.picker.searchLabel")}</span>
          <input
            ref={searchInputRef}
            type="search"
            role="combobox"
            name="settings-language-search"
            className="review-filter-search-input"
            placeholder={t("locale.picker.searchPlaceholder")}
            value={searchText}
            aria-autocomplete="list"
            aria-controls={LANGUAGE_PICKER_LISTBOX_ID}
            aria-expanded={isOpen}
            aria-haspopup="listbox"
            aria-activedescendant={activeOptionId}
            onChange={(event) => setSearchText(event.target.value)}
            onKeyDown={handleComboboxKeyDown}
          />
        </label>
        <div
          id={LANGUAGE_PICKER_LISTBOX_ID}
          className="review-filter-listbox"
          role="listbox"
          aria-label={t("locale.picker.listAriaLabel")}
        >
          {visibleOptions.map((option) => {
            const isSelected = option === localePreference;

            return (
              <div
                key={option}
                id={toLanguagePickerOptionId(option)}
                className={optionClassName(isSelected, option === resolvedActiveLocalePreference)}
                role="option"
                aria-selected={isSelected}
                data-testid={`settings-language-option-${option}`}
                onPointerDown={preventOptionPointerFocus}
                onClick={() => handleSelect(option)}
              >
                <span className="review-filter-menu-item-slot" aria-hidden="true">
                  <span className={`review-filter-menu-item-check${isSelected ? " review-filter-menu-item-check-visible" : ""}`}>
                    <LanguagePickerCheckIcon />
                  </span>
                </span>
                <span className="review-filter-menu-item-label">
                  {option === autoLocalePreference ? t("locale.preferenceAuto") : (
                    <LocaleName locale={option} secondaryClassName="settings-language-picker-option-secondary" />
                  )}
                </span>
              </div>
            );
          })}
        </div>
        {visibleLocales.length === 0 ? (
          <div className="review-filter-menu-empty" aria-live="polite">{t("locale.picker.empty")}</div>
        ) : null}
      </AnchoredFloatingOverlay>
    </>
  );
}
