import Link from 'next/link';
import { ArrowUpRight } from 'lucide-react';
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
