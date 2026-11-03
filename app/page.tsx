"use client";
import SpotlightCard from "@/components/react-bits/SpotlightCard";
import { useEffect, useState } from "react";
import Link from "next/link";
import { WorkspaceTools } from "@/components/workspace-tools";
import { projectRepositories } from "@/lib/project-repositories";
import { ArrowUpRight, Factory, Database, Calculator, Users, UtensilsCrossed, ShoppingBag, ArrowRight, Code2 } from "lucide-react";

const projects = [
  { id: "mes", name: "ForgeFlow", category: "Manufacturing", title: "Every step on the factory floor, in view.", description: "Work orders, production reporting, material lots, and quality records in one workspace.", icon: Factory, color: "#2563eb", steps: ["Orders and materials", "Production reporting", "Material and quality traceability"], limitation: "Equipment data requires connected services; advanced scheduling and rework are not yet implemented." },
  { id: "erp", name: "LedgerWorks", category: "Operations", title: "From inventory to a clearer ledger.", description: "Connect purchasing, warehouse transfers, sales, and accounting.", icon: Database, color: "#047857", steps: ["Purchasing and receiving", "Warehouse transfers", "Accounts and journals"], limitation: "Simplified accounting; invoicing, tax and banking integrations require additional implementation." },
  { id: "pos", name: "CounterPoint", category: "Retail", title: "Simpler checkout, traceable transactions.", description: "Barcode carts, cash checkout, receipts, held carts and shift closing.", icon: Calculator, color: "#b45309", steps: ["Scan and cart", "Checkout and receipts", "Refunds and shift closing"], limitation: "An online demonstration without physical checkout devices or production invoicing." },
  { id: "crm", name: "RelationDesk", category: "Customers", title: "Turn every conversation into an opportunity.", description: "Bring leads, opportunities, follow-ups and support together.", icon: Users, color: "#7c3aed", steps: ["Lead conversion", "Sales pipeline", "Activities and support"], limitation: "Email and SMS integrations and advanced team permissions are not yet implemented." },
  { id: "dining", name: "TableCraft", category: "Dining", title: "From seating to service, keep orders moving.", description: "Connect tables, orders, kitchen workstations and billing.", icon: UtensilsCrossed, color: "#be123c", steps: ["Tables and orders", "Kitchen display", "Bills and simulated payment"], limitation: "Payment is simulated; production payments and kitchen hardware require integration." },
  { id: "shop", name: "MarketLane", category: "Commerce", title: "From discovery to delivery.", description: "Product variants, carts, promotions and orders with a separate operations workspace.", icon: ShoppingBag, color: "#4338ca", steps: ["Variants and cart", "Promotions and orders", "Simulated payment and fulfillment"], limitation: "Payment and shipping adapters are simulated." },
];

export default function PortfolioPage() {
  const [stationBase, setStationBase] = useState("");
  useEffect(() => {
    const configured = process.env.NEXT_PUBLIC_STATION_URL;
    if (configured) setStationBase(configured.replace(/\/$/, ""));
    else if (["localhost", "127.0.0.1"].includes(window.location.hostname)) setStationBase(`${window.location.protocol}//${window.location.hostname}:8095`);
  }, []);
  const [filter, setFilter] = useState("All systems");
  const [selected, setSelected] = useState<string | null>(null);
  const visible = projects.filter(p => filter === "All systems" || (filter === "Operations and manufacturing" ? ["mes", "erp"].includes(p.id) : !["mes", "erp"].includes(p.id)));
  return <main data-site="portfolio" className="portfolio-page">
    <section className="portfolio-hero"><div className="aurora-field" aria-hidden="true"><i/><i/><i/><div className="aurora-grid"/></div>
      <div className="portfolio-hero-copy"><p className="portfolio-eyebrow"><Code2 size={15}/> BUILT FOR THE WAY YOU WORK</p>
        <h1>Make complexity<br/><span>work beautifully.</span></h1>
        <p className="portfolio-lead">From the factory floor to every customer interaction.<br className="hidden md:block"/>Six business systems bring interfaces, data and workflows together.</p>
        <div className="portfolio-hero-actions"><a href="#work" className="portfolio-primary">Explore six systems <ArrowRight size={16}/></a><a href="#about" className="portfolio-secondary">Explore the engineering <ArrowUpRight size={16}/></a></div>
        <p className="portfolio-meta">Interactive portfolio · Demo data</p>
      </div>
      <div className="hero-ecosystem"><div className="orbital-art" aria-hidden="true"><div className="orbit orbit-one"/><div className="orbit orbit-two"/><div className="orbit-core"><span>BS</span><small>CONNECTED BUSINESS</small></div><span className="orbit-label label-one">DESIGN</span><span className="orbit-label label-two">BUILD</span><span className="orbit-label label-three">CONNECT</span></div><div className="portfolio-system-map"><div className="map-title"><span>THE BUSINESS ECOSYSTEM</span><span>01 — 06</span></div><div className="map-grid">{projects.map((p,i)=><Link href={`${stationBase || "https://station.blockchen.duckdns.org"}/${p.id}/login`} key={p.id}><p.icon size={22} strokeWidth={1.4}/><span><b>{p.name}</b><small>{p.category} workspace</small></span><span className="map-number">0{i+1}</span></Link>)}</div><div className="map-caption"><span className="map-dot"/>Six domains, one connected portfolio</div></div></div>
    </section>
    <div className="portfolio-facts"><div><strong>06</strong><span>business domains</span></div><div><strong>08</strong><span>front and back-office views</span></div><div><strong>React + TypeScript</strong><span>interfaces and data workflows</span></div><Link href="/platform">Infrastructure center <ArrowUpRight size={17}/></Link></div>
    <section id="work" className="portfolio-work">
      <div className="portfolio-section-heading"><div><p className="portfolio-eyebrow">01 / APPLICATIONS</p><h2>Every business has its own way of working.</h2><p>Choose a system to explore its workflows.</p></div><div className="portfolio-filters" aria-label="Filter systems">{["All systems","Operations and manufacturing","Sales and service"].map(f=><button key={f} aria-pressed={filter===f} onClick={()=>setFilter(f)}>{f}</button>)}</div></div>
      <div className="portfolio-cards">{visible.map(p=><SpotlightCard key={p.id} className="project-spotlight" spotlightColor={p.color} intensity={0.16} borderGlow={0.8} theme="light">
        <div className="project-visual" data-project={p.id}><span className="project-icon"><p.icon size={38} strokeWidth={1.2}/></span><span className="project-watermark" aria-hidden="true">{p.id.toUpperCase()}</span><div className="project-flow">{p.steps.map((step,i)=><div key={step}><span>0{i+1}</span><b>{step}</b><span className="flow-line"/></div>)}</div><span className="project-category">{p.category} / {p.id.toUpperCase()}</span></div>
        <div className="project-body"><p className="project-name">{p.name}<ArrowUpRight size={17}/></p><h3>{p.title}</h3><p className="project-description">{p.description}</p>
          {selected===p.id&&<div className="project-boundary" id={`boundary-${p.id}`}><b>Scope</b><p>{p.limitation}</p><p>Initial records are demonstration data.</p></div>}
          <div className="project-actions"><button aria-expanded={selected===p.id} aria-controls={selected===p.id?`boundary-${p.id}`:undefined} onClick={()=>setSelected(selected===p.id?null:p.id)}>{selected===p.id?"Hide details":"View details"}</button><Link href={`${stationBase || "https://station.blockchen.duckdns.org"}/${p.id}/login`}>Enter workspace <ArrowRight size={15}/></Link></div><a className="station-entry" href={projectRepositories[p.id as keyof typeof projectRepositories]} target="_blank" rel="noopener noreferrer">View source on GitHub <ArrowUpRight size={14}/></a>{stationBase && <a className="station-entry" href={`${stationBase}/${p.id}/login`} target="_blank" rel="noreferrer">Sign in to workspace <ArrowUpRight size={14}/></a>}
        </div>
      </SpotlightCard>)}</div>
    </section>
    <section id="about" className="portfolio-about"><div><p className="portfolio-eyebrow">02 / BUILT UNDERNEATH</p><h2>Under the surface,<br/>every action has context.</h2><p>Orders, inventory, payments and production records connect through verifiable workflows.</p><Link href="/platform">Explore infrastructure <ArrowUpRight size={15}/></Link></div><div className="portfolio-capabilities">{[["01","Interface and interaction","Responsive workspaces, validation and clear feedback."],["02","Data and workflows","APIs, persistent data, domain services and transaction records."],["03","Testing and delivery","Tests verify amounts, inventory and state transitions; external services require integration."]].map(([n,t,d])=><div key={n}><span>{n}</span><div><h3>{t}</h3><p>{d}</p></div></div>)}</div></section>

    <section className="portfolio-tools"><div className="portfolio-section-heading"><div><p className="portfolio-eyebrow">03 / YOUR WORKSPACE</p><h2>Keep your work in your own space.</h2></div></div><WorkspaceTools/></section>
  </main>;
}
