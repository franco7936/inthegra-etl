'use client';

import Link from 'next/link';
import { ArrowUpRight, CalendarDays, Check, ChevronDown, ChevronLeft, ChevronRight } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { cn } from '@/lib/utils';

export function PageSection({ children, className = '' }) {
  return <section className={cn('designSection', className)}>{children}</section>;
}

export function Surface({ children, className = '' }) {
  return <div className={cn('designSurface', className)}>{children}</div>;
}

export function ReportCard({ report, meta = '', icon: Icon }) {
  return (
    <Link className="modernReportCard" href={report.href}>
      <span className="modernReportIcon">{Icon ? <Icon size={19} /> : report.tile}</span>
      <span className="modernReportContent">
        <small>{meta}</small>
        <strong>{report.label}</strong>
        <em>{report.description}</em>
      </span>
      <ArrowUpRight size={18} className="modernReportArrow" />
    </Link>
  );
}


const MONTHS = ['Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio', 'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre'];
const SHORT_DAYS = ['L', 'M', 'M', 'J', 'V', 'S', 'D'];

function pad(value) { return String(value).padStart(2, '0'); }

function useOutsideClose(ref, onClose) {
  useEffect(() => {
    function handleClick(event) { if (ref.current && !ref.current.contains(event.target)) onClose(); }
    function handleEscape(event) { if (event.key === 'Escape') onClose(); }
    document.addEventListener('mousedown', handleClick);
    document.addEventListener('keydown', handleEscape);
    return () => {
      document.removeEventListener('mousedown', handleClick);
      document.removeEventListener('keydown', handleEscape);
    };
  }, [ref, onClose]);
}

function parseMonth(value) {
  const [year, month] = String(value || '').split('-').map(Number);
  const now = new Date();
  return { year: year || now.getFullYear(), month: month && month >= 1 && month <= 12 ? month : now.getMonth() + 1 };
}

function parseDateValue(value) {
  const [year, month, day] = String(value || '').split('-').map(Number);
  if (!year || !month || !day) return null;
  return new Date(Date.UTC(year, month - 1, day));
}

function formatDateLabel(value) {
  const date = parseDateValue(value);
  if (!date) return 'Seleccionar fecha';
  return new Intl.DateTimeFormat('es-AR', { day: '2-digit', month: 'short', year: 'numeric', timeZone: 'UTC' }).format(date);
}

function monthLabel(value) {
  const parsed = parseMonth(value);
  return MONTHS[parsed.month - 1] + ' ' + parsed.year;
}

export function ModernSelect({ value, onChange, options = [], placeholder = 'Seleccionar', disabled = false }) {
  const [open, setOpen] = useState(false);
  const wrapperRef = useRef(null);
  useOutsideClose(wrapperRef, () => setOpen(false));
  const selected = options.find((option) => String(option.value) === String(value));
  const label = selected?.label || placeholder;

  function selectOption(nextValue) {
    onChange?.(nextValue);
    setOpen(false);
  }

  return (
    <span className={'modernControl modernSelect ' + (open ? 'isOpen ' : '') + (disabled ? 'isDisabled' : '')} ref={wrapperRef}>
      <button type="button" className="modernControlButton" disabled={disabled} onClick={() => setOpen(!open)}>
        <span>{label}</span>
        <ChevronDown size={17} />
      </button>
      {open && (
        <span className="modernDropdown modernSelectMenu">
          {options.map((option) => {
            const active = String(option.value) === String(value);
            return (
              <button type="button" className={active ? 'active' : ''} key={String(option.value)} onClick={() => selectOption(option.value)}>
                <span>{option.label}</span>
                {active && <Check size={16} />}
              </button>
            );
          })}
        </span>
      )}
    </span>
  );
}

export function ModernMonthPicker({ value, onChange }) {
  const parsed = parseMonth(value);
  const [year, setYear] = useState(parsed.year);
  const [open, setOpen] = useState(false);
  const wrapperRef = useRef(null);
  useOutsideClose(wrapperRef, () => setOpen(false));

  useEffect(() => { setYear(parsed.year); }, [parsed.year]);

  function selectMonth(month) {
    onChange?.(String(year) + '-' + pad(month));
    setOpen(false);
  }

  return (
    <span className={'modernControl modernMonthPicker ' + (open ? 'isOpen' : '')} ref={wrapperRef}>
      <button type="button" className="modernControlButton" onClick={() => setOpen(!open)}>
        <span>{monthLabel(value)}</span>
        <CalendarDays size={17} />
      </button>
      {open && (
        <span className="modernDropdown modernCalendarPanel">
          <span className="modernCalendarHeader">
            <button type="button" onClick={() => setYear(year - 1)}><ChevronLeft size={17} /></button>
            <strong>{year}</strong>
            <button type="button" onClick={() => setYear(year + 1)}><ChevronRight size={17} /></button>
          </span>
          <span className="modernMonthGrid">
            {MONTHS.map((name, index) => {
              const month = index + 1;
              const active = parsed.year === year && parsed.month === month;
              return <button type="button" className={active ? 'active' : ''} key={name} onClick={() => selectMonth(month)}>{name.slice(0, 3)}</button>;
            })}
          </span>
        </span>
      )}
    </span>
  );
}

export function ModernDatePicker({ value, onChange }) {
  const initialDate = parseDateValue(value) || new Date();
  const [cursor, setCursor] = useState({ year: initialDate.getUTCFullYear(), month: initialDate.getUTCMonth() + 1 });
  const [open, setOpen] = useState(false);
  const wrapperRef = useRef(null);
  useOutsideClose(wrapperRef, () => setOpen(false));
  const selected = parseDateValue(value);

  useEffect(() => {
    const date = parseDateValue(value);
    if (date) setCursor({ year: date.getUTCFullYear(), month: date.getUTCMonth() + 1 });
  }, [value]);

  const days = useMemo(() => {
    const first = new Date(Date.UTC(cursor.year, cursor.month - 1, 1));
    const startOffset = (first.getUTCDay() + 6) % 7;
    const totalDays = new Date(Date.UTC(cursor.year, cursor.month, 0)).getUTCDate();
    return [...Array.from({ length: startOffset }, () => null), ...Array.from({ length: totalDays }, (_, index) => index + 1)];
  }, [cursor]);

  function moveMonth(delta) {
    const date = new Date(Date.UTC(cursor.year, cursor.month - 1 + delta, 1));
    setCursor({ year: date.getUTCFullYear(), month: date.getUTCMonth() + 1 });
  }

  function selectDay(day) {
    onChange?.(String(cursor.year) + '-' + pad(cursor.month) + '-' + pad(day));
    setOpen(false);
  }

  return (
    <span className={'modernControl modernDatePicker ' + (open ? 'isOpen' : '')} ref={wrapperRef}>
      <button type="button" className="modernControlButton" onClick={() => setOpen(!open)}>
        <span>{formatDateLabel(value)}</span>
        <CalendarDays size={17} />
      </button>
      {open && (
        <span className="modernDropdown modernCalendarPanel datePanel">
          <span className="modernCalendarHeader">
            <button type="button" onClick={() => moveMonth(-1)}><ChevronLeft size={17} /></button>
            <strong>{MONTHS[cursor.month - 1]} {cursor.year}</strong>
            <button type="button" onClick={() => moveMonth(1)}><ChevronRight size={17} /></button>
          </span>
          <span className="modernWeekGrid">{SHORT_DAYS.map((day) => <small key={day}>{day}</small>)}</span>
          <span className="modernDayGrid">
            {days.map((day, index) => {
              if (!day) return <i key={'empty-' + index} />;
              const active = selected && selected.getUTCFullYear() === cursor.year && selected.getUTCMonth() + 1 === cursor.month && selected.getUTCDate() === day;
              return <button type="button" className={active ? 'active' : ''} key={day} onClick={() => selectDay(day)}>{day}</button>;
            })}
          </span>
        </span>
      )}
    </span>
  );
}
