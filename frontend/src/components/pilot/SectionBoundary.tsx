/**
 * SectionBoundary — a tiny error boundary so one failing landing section renders
 * a quiet fallback instead of blanking the entire page (Suspense doesn't catch
 * render errors).
 */
import { Component, type ReactNode } from 'react';

export class SectionBoundary extends Component<{ children: ReactNode; label?: string }, { error: Error | null }> {
  state = { error: null as Error | null };
  static getDerivedStateFromError(error: Error) { return { error }; }
  componentDidCatch(error: Error) { console.error('[SectionBoundary]', this.props.label, error); }
  render() {
    if (this.state.error) {
      return (
        <section className="py-16 px-6 text-center">
          <p className="text-xs font-mono text-[var(--text-muted)]">
            {this.props.label ?? 'This section'} hit an error and was skipped.
          </p>
        </section>
      );
    }
    return this.props.children;
  }
}

export default SectionBoundary;
