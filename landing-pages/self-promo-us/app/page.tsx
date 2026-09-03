import { ArrowRight, Check, Menu } from 'lucide-react'
import { ContactForm } from './contact-form'

const services = [
  {
    number: '01',
    title: 'Google Ads Management',
    description: 'Search, Shopping, and Performance Max campaigns built, optimized, and reported on every month.',
  },
  {
    number: '02',
    title: 'Meta Ads Management',
    description: 'Audience strategy, creative testing, and conversion campaigns managed across Facebook and Instagram.',
  },
  {
    number: '03',
    title: 'OpenAI Ads Management',
    description: 'Early strategy and ongoing management for official ChatGPT Ads as the channel opens to US businesses.',
  },
]

const process = [
  ['Free strategy call', 'We review your goals, current spend, and where your next customers are coming from.'],
  ['Strategy & setup', 'We build the campaign structure, tracking, audiences, creative direction, and launch plan.'],
  ['Management & reporting', 'We monitor performance, optimize toward your goals, and send clear monthly reporting.'],
  ['Monthly review', 'You get a focused review of what changed, what we learned, and what happens next.'],
]

const reasons = [
  'Full-service execution, not a one-time audit or a slide deck',
  'Data-driven optimization tied to the outcomes your business needs',
  'Transparent reporting in plain English, without vanity metrics',
  'Early access to new ad platforms, including official ChatGPT Ads',
]

export default function Home() {
  return (
    <main className="min-h-screen overflow-hidden bg-background text-foreground">
      <header className="mx-auto flex max-w-7xl items-center justify-between px-6 py-6 lg:px-10">
        <a href="#top" className="flex items-center gap-3" aria-label="Kalinin Digital Agency home">
          <span className="flex size-9 items-center justify-center bg-primary text-sm font-bold text-primary-foreground">KD</span>
          <span className="font-mono text-xs font-semibold uppercase tracking-[0.16em]">Kalinin Digital Agency</span>
        </a>
        <nav className="hidden items-center gap-8 text-sm text-muted-foreground md:flex" aria-label="Main navigation">
          <a href="#why-now" className="transition-colors hover:text-foreground">Why now</a>
          <a href="#services" className="transition-colors hover:text-foreground">Services</a>
          <a href="#process" className="transition-colors hover:text-foreground">How it works</a>
          <a href="#contact" className="flex items-center gap-2 font-medium text-foreground hover:text-accent-foreground">
            Book a call <ArrowRight className="size-4" aria-hidden="true" />
          </a>
        </nav>
        <button className="md:hidden" aria-label="Open navigation"><Menu className="size-5" /></button>
      </header>

      <section id="top" className="mx-auto grid max-w-7xl gap-14 px-6 pb-24 pt-20 lg:grid-cols-[1.25fr_0.75fr] lg:items-end lg:px-10 lg:pb-32 lg:pt-28">
        <div>
          <p className="mb-8 font-mono text-xs font-semibold uppercase tracking-[0.18em] text-accent-foreground">Paid growth for American businesses</p>
          <h1 className="max-w-4xl text-balance font-sans text-5xl font-semibold leading-[0.98] tracking-[-0.055em] sm:text-6xl lg:text-8xl">Grow your US business with ads that are expertly managed.</h1>
          <p className="mt-8 max-w-xl text-pretty text-lg leading-7 text-muted-foreground">We set up and continuously manage paid campaigns across Google, Meta, and the newest channel: ChatGPT Ads. You get a focused partner and a clearer path to results.</p>
          <a href="#contact" className="mt-10 inline-flex items-center gap-3 bg-accent px-5 py-3.5 text-sm font-semibold text-accent-foreground transition-transform hover:-translate-y-0.5">Book a free strategy call <ArrowRight className="size-4" aria-hidden="true" /></a>
        </div>
        <div className="border-l border-border pl-6 lg:mb-2">
          <p className="max-w-xs text-sm leading-6 text-muted-foreground">For small and mid-size US businesses that want someone to own the work — from first campaign build to every monthly optimization.</p>
          <div className="mt-12 flex items-center gap-3 font-mono text-xs uppercase tracking-[0.14em] text-muted-foreground"><span className="size-2 bg-accent" /> Google · Meta · OpenAI</div>
        </div>
      </section>

      <section id="why-now" className="border-y border-border bg-secondary">
        <div className="mx-auto grid max-w-7xl gap-12 px-6 py-20 lg:grid-cols-[0.75fr_1.25fr] lg:px-10 lg:py-24">
          <div><p className="font-mono text-xs font-semibold uppercase tracking-[0.18em] text-accent-foreground">Why now</p><h2 className="mt-5 max-w-md text-balance text-3xl font-semibold leading-tight tracking-[-0.04em] sm:text-4xl">The next ad channel is already taking shape.</h2></div>
          <div className="max-w-2xl"><p className="text-pretty text-xl leading-8">Google Ads and Meta Ads are established channels. OpenAI Ads is the early-mover opportunity: a new place to reach people while most competitors are still watching from the sidelines.</p><p className="mt-6 max-w-xl text-sm leading-6 text-muted-foreground">These are official, native advertising platforms — not gimmicks, hacks, or rented attention. We help you build the right foundation now, then manage each channel as it evolves.</p></div>
        </div>
      </section>

      <section id="services" className="mx-auto max-w-7xl px-6 py-24 lg:px-10 lg:py-32">
        <div className="flex flex-col justify-between gap-6 border-b border-border pb-8 md:flex-row md:items-end"><div><p className="font-mono text-xs font-semibold uppercase tracking-[0.18em] text-accent-foreground">What we manage</p><h2 className="mt-4 text-3xl font-semibold tracking-[-0.04em] sm:text-4xl">One partner. Every important channel.</h2></div><p className="max-w-xs text-sm leading-6 text-muted-foreground">No handoffs. No disappearing after launch. The work continues every month.</p></div>
        <div className="grid divide-y divide-border md:grid-cols-3 md:divide-x md:divide-y-0">
          {services.map((service) => <article key={service.number} className="py-8 md:px-8 md:first:pl-0 md:last:pr-0"><p className="font-mono text-xs text-muted-foreground">{service.number}</p><h3 className="mt-14 max-w-xs text-xl font-semibold tracking-[-0.025em]">{service.title}</h3><p className="mt-4 max-w-xs text-sm leading-6 text-muted-foreground">{service.description}</p></article>)}
        </div>
      </section>

      <section id="process" className="bg-primary text-primary-foreground">
        <div className="mx-auto max-w-7xl px-6 py-24 lg:px-10 lg:py-28"><div className="grid gap-14 lg:grid-cols-[0.7fr_1.3fr]"><div><p className="font-mono text-xs font-semibold uppercase tracking-[0.18em] text-accent">How it works</p><h2 className="mt-5 max-w-sm text-balance text-4xl font-semibold leading-tight tracking-[-0.045em]">A steady operating rhythm for better campaigns.</h2></div><div className="grid border-t border-primary-foreground/20 sm:grid-cols-2">{process.map(([title, description], index) => <div key={title} className="border-b border-primary-foreground/20 py-7 sm:px-6 sm:first:pl-0"><div className="flex items-start gap-4"><span className="font-mono text-xs text-accent">0{index + 1}</span><div><h3 className="font-semibold">{title}</h3><p className="mt-3 max-w-xs text-sm leading-6 text-primary-foreground/65">{description}</p></div></div></div>)}</div></div></div>
      </section>

      <section className="mx-auto grid max-w-7xl gap-14 px-6 py-24 lg:grid-cols-[0.75fr_1.25fr] lg:px-10 lg:py-32"><div><p className="font-mono text-xs font-semibold uppercase tracking-[0.18em] text-accent-foreground">Why Kalinin Digital</p><h2 className="mt-5 max-w-md text-balance text-3xl font-semibold leading-tight tracking-[-0.04em] sm:text-4xl">You stay close to the decisions. We own the details.</h2></div><ul className="max-w-2xl divide-y divide-border border-t border-border">{reasons.map((reason) => <li key={reason} className="flex gap-4 py-5 text-lg leading-7"><Check className="mt-1 size-5 shrink-0 text-accent-foreground" aria-hidden="true" />{reason}</li>)}</ul></section>

      <section id="contact" className="border-t border-border bg-secondary"><div className="mx-auto flex max-w-7xl flex-col gap-10 px-6 py-20 lg:flex-row lg:items-end lg:justify-between lg:px-10 lg:py-28"><div><p className="font-mono text-xs font-semibold uppercase tracking-[0.18em] text-accent-foreground">Ready to get serious about paid growth?</p><h2 className="mt-5 max-w-2xl text-balance text-4xl font-semibold leading-tight tracking-[-0.045em] sm:text-6xl">Let&apos;s make your ad spend work harder.</h2><a href="mailto:hello@kalinindigital.com" className="mt-6 inline-block font-mono text-xs text-muted-foreground underline underline-offset-4">or email hello@kalinindigital.com directly</a></div><ContactForm /></div></section>

      <footer className="mx-auto flex max-w-7xl flex-col gap-3 px-6 py-8 text-xs text-muted-foreground sm:flex-row sm:items-center sm:justify-between lg:px-10"><span className="font-mono font-semibold uppercase tracking-[0.14em] text-foreground">Kalinin Digital Agency</span><span>Paid advertising management for US businesses.</span><span>© 2026 Kalinin Digital Agency</span></footer>
    </main>
  )
}
