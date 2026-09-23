const pad = (value) => String(value).padStart(2, "0");

function localDateTimeParts(date) {
  return {
    year: date.getFullYear(),
    month: date.getMonth(),
    day: date.getDate(),
    hours: date.getHours(),
    minutes: date.getMinutes(),
  };
}

function parseLocalDateTime(value) {
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/.exec(value || "");
  if (!match) return null;
  const parts = {
    year: Number(match[1]),
    month: Number(match[2]) - 1,
    day: Number(match[3]),
    hours: Number(match[4]),
    minutes: Number(match[5]),
  };
  const date = new Date(parts.year, parts.month, parts.day, parts.hours, parts.minutes);
  if (date.getFullYear() !== parts.year || date.getMonth() !== parts.month || date.getDate() !== parts.day ||
    date.getHours() !== parts.hours || date.getMinutes() !== parts.minutes) return null;
  return parts;
}

function parseDateKey(value) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value || "");
  if (!match) return null;
  const date = new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
  if (date.getFullYear() !== Number(match[1]) || date.getMonth() !== Number(match[2]) - 1 || date.getDate() !== Number(match[3])) return null;
  return date;
}

function dateKey(date) {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

function formatLocalDateTime(parts) {
  return `${parts.year}-${pad(parts.month + 1)}-${pad(parts.day)}T${pad(parts.hours)}:${pad(parts.minutes)}`;
}

function clamp(value, min, max) { return Math.min(max, Math.max(min, value)); }

export class KafkaDateTimePicker {
  constructor({ root, input }) {
    this.root = root;
    this.input = input;
    this.calendarPlaceholder = null;
    this.selected = null;
    this.viewMonth = null;
    this.handleOutsideClick = (event) => {
      if (!this.root?.contains(event.target) && !this.calendar?.contains(event.target)) this.close();
    };
    this.handleDayClick = (event) => {
      const day = event.target.closest("button[data-date]");
      if (day && !day.disabled) this.selectDate(day.dataset.date);
    };
    this.handleCalendarKeydown = (event) => this.handleKeydown(event);
    this.handleHoursInput = () => this.updateTime("hours");
    this.handleMinutesInput = () => this.updateTime("minutes");
    this.handleTimeBlur = () => this.normalizeTimeInputs();
    this.handlePrevious = () => this.shiftMonth(-1);
    this.handleNext = () => this.shiftMonth(1);
    this.handleNow = () => this.selectNow();
    this.handleApply = () => this.apply();
    this.handleCancel = () => this.close({ restoreFocus: true });
    this.handleViewportChange = () => {
      if (!this.calendar?.hidden) this.positionPopover();
    };
  }

  mount() {
    if (!this.root || !this.input) return;
    this.trigger = this.root.querySelector("#kafkaHistoryTrigger");
    this.calendar = this.root.querySelector("#kafkaHistoryCalendar");
    this.display = this.root.querySelector("#kafkaHistoryDisplay");
    this.title = this.root.querySelector("#kafkaHistoryCalendarTitle");
    this.days = this.root.querySelector("#kafkaHistoryDays");
    this.previous = this.root.querySelector("#kafkaHistoryPrevious");
    this.next = this.root.querySelector("#kafkaHistoryNext");
    this.hours = this.root.querySelector("#kafkaHistoryHours");
    this.minutes = this.root.querySelector("#kafkaHistoryMinutes");
    this.now = this.root.querySelector("#kafkaHistoryNow");
    this.applyButton = this.root.querySelector("#kafkaHistoryApply");
    this.trigger.addEventListener("click", () => this.toggle());
    this.calendar.addEventListener("click", this.handleDayClick);
    this.calendar.addEventListener("keydown", this.handleCalendarKeydown);
    this.previous.addEventListener("click", this.handlePrevious);
    this.next.addEventListener("click", this.handleNext);
    this.hours.addEventListener("input", this.handleHoursInput);
    this.minutes.addEventListener("input", this.handleMinutesInput);
    this.hours.addEventListener("blur", this.handleTimeBlur);
    this.minutes.addEventListener("blur", this.handleTimeBlur);
    this.now.addEventListener("click", this.handleNow);
    this.applyButton.addEventListener("click", this.handleApply);
    this.root.querySelector("#kafkaHistoryCancel").addEventListener("click", this.handleCancel);
    document.addEventListener("click", this.handleOutsideClick);
    window.addEventListener("resize", this.handleViewportChange);
    window.addEventListener("scroll", this.handleViewportChange, true);
    this.calendarPlaceholder = document.createComment("kafka-history-calendar");
    this.calendar.replaceWith(this.calendarPlaceholder);
    document.body.append(this.calendar);
    this.loadFromInput();
  }

  destroy() {
    document.removeEventListener("click", this.handleOutsideClick);
    window.removeEventListener("resize", this.handleViewportChange);
    window.removeEventListener("scroll", this.handleViewportChange, true);
    this.close();
    this.calendarPlaceholder?.replaceWith(this.calendar);
    this.calendarPlaceholder = null;
  }

  toggle() {
    if (this.calendar.hidden) this.open();
    else this.close({ restoreFocus: true });
  }

  open() {
    this.loadFromInput();
    this.calendar.hidden = false;
    this.trigger.setAttribute("aria-expanded", "true");
    this.positionPopover();
    this.focusDay(this.selectedKey());
  }

  close({ restoreFocus = false } = {}) {
    if (!this.calendar) return;
    this.calendar.hidden = true;
    this.trigger?.setAttribute("aria-expanded", "false");
    if (restoreFocus) this.trigger?.focus();
  }

  positionPopover() {
    if (!this.calendar || this.calendar.hidden || !this.trigger) return;
    const isMobileSheet = typeof window.matchMedia === "function" && window.matchMedia("(max-width: 520px)").matches;
    if (isMobileSheet) {
      this.calendar.classList.remove("is-above");
      this.calendar.style.removeProperty("top");
      this.calendar.style.removeProperty("left");
      this.calendar.style.removeProperty("max-height");
      return;
    }
    this.calendar.style.removeProperty("max-height");
    const triggerRect = this.trigger.getBoundingClientRect();
    const calendarRect = this.calendar.getBoundingClientRect();
    const viewportWidth = window.innerWidth || document.documentElement.clientWidth;
    const viewportHeight = window.innerHeight || document.documentElement.clientHeight;
    const gap = 8;
    const viewportGutter = 16;
    const spaceAbove = Math.max(0, triggerRect.top - gap - viewportGutter);
    const spaceBelow = Math.max(0, viewportHeight - triggerRect.bottom - gap - viewportGutter);
    const fitsBelow = calendarRect.height <= spaceBelow;
    const fitsAbove = calendarRect.height <= spaceAbove;
    const fitsViewport = calendarRect.height <= Math.max(0, viewportHeight - viewportGutter * 2);
    let opensAbove = false;
    let top;
    if (fitsBelow) {
      top = triggerRect.bottom + gap;
    } else if (fitsAbove) {
      opensAbove = true;
      top = triggerRect.top - gap - calendarRect.height;
    } else if (fitsViewport) {
      top = Math.min(triggerRect.bottom + gap, viewportHeight - calendarRect.height - viewportGutter);
      opensAbove = top + calendarRect.height < triggerRect.top;
    } else {
      opensAbove = spaceAbove > spaceBelow;
      const availableSpace = opensAbove ? spaceAbove : spaceBelow;
      top = opensAbove ? triggerRect.top - gap - availableSpace : triggerRect.bottom + gap;
      this.calendar.style.maxHeight = `${Math.floor(availableSpace)}px`;
    }
    this.calendar.classList.toggle("is-above", opensAbove);
    const maxLeft = Math.max(viewportGutter, viewportWidth - calendarRect.width - viewportGutter);
    const left = clamp(triggerRect.left, viewportGutter, maxLeft);
    this.calendar.style.left = `${Math.round(left)}px`;
    this.calendar.style.top = `${Math.round(top)}px`;
  }

  loadFromInput() {
    this.selected = parseLocalDateTime(this.input.value) || localDateTimeParts(new Date(Date.now() - 24 * 60 * 60 * 1000));
    this.viewMonth = new Date(this.selected.year, this.selected.month, 1);
    this.render();
  }

  render() {
    if (!this.selected || !this.viewMonth || !this.days) return;
    const year = this.viewMonth.getFullYear();
    const month = this.viewMonth.getMonth();
    const selectedKey = this.selectedKey();
    const todayKey = dateKey(new Date());
    this.title.textContent = this.viewMonth.toLocaleDateString(undefined, { month: "long", year: "numeric" });
    this.days.replaceChildren();
    const firstDayOffset = new Date(year, month, 1).getDay();
    for (let index = 0; index < 42; index++) {
      const date = new Date(year, month, index - firstDayOffset + 1);
      const key = dateKey(date);
      const button = document.createElement("button");
      button.type = "button";
      button.className = "kafka-date-day";
      button.dataset.date = key;
      button.textContent = String(date.getDate());
      button.tabIndex = -1;
      button.disabled = this.isFutureDay(date);
      button.setAttribute("aria-label", date.toLocaleDateString(undefined, { weekday: "long", month: "long", day: "numeric", year: "numeric" }));
      button.setAttribute("aria-selected", String(key === selectedKey));
      if (date.getMonth() !== month) button.classList.add("is-outside");
      if (key === todayKey) { button.classList.add("is-today"); button.setAttribute("aria-current", "date"); }
      if (key === selectedKey) button.classList.add("is-selected");
      this.days.append(button);
    }
    const focusable = this.days.querySelector(`button[data-date="${selectedKey}"]:not(:disabled)`) ||
      this.days.querySelector("button:not(.is-outside):not(:disabled)") || this.days.querySelector("button:not(:disabled)");
    focusable?.setAttribute("tabindex", "0");
    this.previous.disabled = false;
    this.next.disabled = this.isCurrentOrFutureMonth(this.viewMonth);
    this.hours.value = pad(this.selected.hours);
    this.minutes.value = pad(this.selected.minutes);
    this.applyButton.disabled = this.isFutureSelection();
    this.display.textContent = this.formatDisplay(parseLocalDateTime(this.input.value) || this.selected);
  }

  selectedKey() { return `${this.selected.year}-${pad(this.selected.month + 1)}-${pad(this.selected.day)}`; }

  formatDisplay(parts) {
    const date = new Date(parts.year, parts.month, parts.day);
    return `${date.toLocaleDateString(undefined, { day: "2-digit", month: "short", year: "numeric" })}, ${pad(parts.hours)}:${pad(parts.minutes)}`;
  }

  isFutureDay(date) {
    const candidate = new Date(date.getFullYear(), date.getMonth(), date.getDate());
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    return candidate > today;
  }

  isFutureSelection() {
    const candidate = new Date(this.selected.year, this.selected.month, this.selected.day, this.selected.hours, this.selected.minutes);
    return candidate > new Date();
  }

  isCurrentOrFutureMonth(date) {
    const now = new Date();
    return date.getFullYear() > now.getFullYear() || (date.getFullYear() === now.getFullYear() && date.getMonth() >= now.getMonth());
  }

  selectDate(value) {
    const date = parseDateKey(value);
    if (!date || this.isFutureDay(date)) return;
    this.selected.year = date.getFullYear();
    this.selected.month = date.getMonth();
    this.selected.day = date.getDate();
    this.viewMonth = new Date(date.getFullYear(), date.getMonth(), 1);
    this.render();
    this.focusDay(value);
  }

  selectNow() {
    this.selected = localDateTimeParts(new Date());
    this.viewMonth = new Date(this.selected.year, this.selected.month, 1);
    this.render();
  }

  shiftMonth(delta) {
    const next = new Date(this.viewMonth.getFullYear(), this.viewMonth.getMonth() + delta, 1);
    if (delta > 0 && this.isCurrentOrFutureMonth(next)) return;
    this.viewMonth = next;
    this.render();
    this.focusDay(this.selectedKey());
  }

  focusDay(value) {
    const selected = this.days?.querySelector(`button[data-date="${value}"]:not(:disabled)`) ||
      this.days?.querySelector("button:not(:disabled)");
    selected?.focus();
  }

  handleKeydown(event) {
    if (event.key === "Escape") {
      event.preventDefault();
      this.close({ restoreFocus: true });
      return;
    }
    const day = event.target.closest("button[data-date]");
    if (!day) return;
    if (event.key === "PageUp" || event.key === "PageDown") {
      event.preventDefault();
      this.shiftMonth(event.key === "PageUp" ? -1 : 1);
      return;
    }
    const current = parseDateKey(day.dataset.date);
    if (!current) return;
    const offsets = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -7, ArrowDown: 7 };
    if (!(event.key in offsets)) return;
    event.preventDefault();
    const next = new Date(current.getFullYear(), current.getMonth(), current.getDate() + offsets[event.key]);
    this.selectDate(dateKey(next));
  }

  updateTime(part) {
    const input = part === "hours" ? this.hours : this.minutes;
    const max = part === "hours" ? 23 : 59;
    const value = Number.parseInt(input.value, 10);
    this.selected[part] = clamp(Number.isFinite(value) ? value : 0, 0, max);
    this.applyButton.disabled = this.isFutureSelection();
  }

  normalizeTimeInputs() {
    this.updateTime("hours");
    this.updateTime("minutes");
    this.hours.value = pad(this.selected.hours);
    this.minutes.value = pad(this.selected.minutes);
  }

  apply() {
    this.normalizeTimeInputs();
    if (this.isFutureSelection()) return;
    this.input.value = formatLocalDateTime(this.selected);
    this.display.textContent = this.formatDisplay(this.selected);
    this.close({ restoreFocus: true });
  }
}
