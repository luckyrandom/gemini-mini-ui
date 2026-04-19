// Icons — minimal stroke set, 14-16px grid
const iconProps = (size = 14) => ({
  width: size, height: size,
  viewBox: "0 0 24 24",
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 1.8,
  strokeLinecap: "round",
  strokeLinejoin: "round",
});

const SidebarIcon = ({ size }) => (
  <svg {...iconProps(size)}>
    <rect x="3" y="4" width="18" height="16" rx="2" />
    <line x1="9" y1="4" x2="9" y2="20" />
  </svg>
);
const GearIcon = ({ size }) => (
  <svg {...iconProps(size)}>
    <circle cx="12" cy="12" r="3" />
    <path d="M19.4 15a1.7 1.7 0 0 0 .34 1.87l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.7 1.7 0 0 0-1.87-.34 1.7 1.7 0 0 0-1 1.56V21a2 2 0 1 1-4 0v-.09A1.7 1.7 0 0 0 9 19.4a1.7 1.7 0 0 0-1.87.34l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06A1.7 1.7 0 0 0 4.6 15a1.7 1.7 0 0 0-1.56-1H3a2 2 0 1 1 0-4h.09A1.7 1.7 0 0 0 4.6 9a1.7 1.7 0 0 0-.34-1.87l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06A1.7 1.7 0 0 0 9 4.6a1.7 1.7 0 0 0 1-1.56V3a2 2 0 1 1 4 0v.09A1.7 1.7 0 0 0 15 4.6a1.7 1.7 0 0 0 1.87-.34l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06A1.7 1.7 0 0 0 19.4 9c.22.6.77 1 1.42 1H21a2 2 0 1 1 0 4h-.09a1.7 1.7 0 0 0-1.51 1z" />
  </svg>
);
const PanelRightIcon = ({ size }) => (
  <svg {...iconProps(size)}>
    <rect x="3" y="4" width="18" height="16" rx="2" />
    <line x1="15" y1="4" x2="15" y2="20" />
  </svg>
);
const SearchIcon = ({ size = 12 }) => (
  <svg {...iconProps(size)}>
    <circle cx="11" cy="11" r="7" />
    <line x1="21" y1="21" x2="16.65" y2="16.65" />
  </svg>
);
const PlusIcon = ({ size = 12 }) => (
  <svg {...iconProps(size)}>
    <line x1="12" y1="5" x2="12" y2="19" />
    <line x1="5" y1="12" x2="19" y2="12" />
  </svg>
);
const MoreIcon = ({ size = 13 }) => (
  <svg {...iconProps(size)}>
    <circle cx="5" cy="12" r="1" />
    <circle cx="12" cy="12" r="1" />
    <circle cx="19" cy="12" r="1" />
  </svg>
);
const CopyIcon = ({ size = 11 }) => (
  <svg {...iconProps(size)}>
    <rect x="9" y="9" width="12" height="12" rx="2" />
    <path d="M5 15V5a2 2 0 0 1 2-2h10" />
  </svg>
);
const RegenIcon = ({ size = 11 }) => (
  <svg {...iconProps(size)}>
    <path d="M21 12a9 9 0 1 1-3-6.7" />
    <polyline points="21 3 21 9 15 9" />
  </svg>
);
const SendIcon = ({ size = 14 }) => (
  <svg {...iconProps(size)}>
    <path d="M5 12h14" />
    <path d="M13 6l6 6-6 6" />
  </svg>
);
const StopIcon = ({ size = 12 }) => (
  <svg viewBox="0 0 24 24" width={size} height={size} fill="currentColor">
    <rect x="6" y="6" width="12" height="12" rx="1.5" />
  </svg>
);
const PaperclipIcon = ({ size = 13 }) => (
  <svg {...iconProps(size)}>
    <path d="M21 12.5L13 20.5a5 5 0 0 1-7-7l8-8a3.5 3.5 0 0 1 5 5l-7.8 7.8a2 2 0 0 1-2.8-2.8L16 8" />
  </svg>
);
const ChevronRightIcon = ({ size = 11 }) => (
  <svg {...iconProps(size)}>
    <polyline points="9 6 15 12 9 18" />
  </svg>
);
const ChevronDownIcon = ({ size = 12 }) => (
  <svg {...iconProps(size)}>
    <polyline points="6 9 12 15 18 9" />
  </svg>
);
const ToolIcon = ({ size = 12 }) => (
  <svg {...iconProps(size)}>
    <path d="M14.7 6.3a4 4 0 0 0-5.4 5.4L3 18l3 3 6.3-6.3a4 4 0 0 0 5.4-5.4l-2.6 2.6-2.4-2.4z" />
  </svg>
);
const SparkleIcon = ({ size = 22 }) => (
  <svg {...iconProps(size)}>
    <path d="M12 3l2 5 5 2-5 2-2 5-2-5-5-2 5-2z" />
  </svg>
);
const AlertIcon = ({ size = 12 }) => (
  <svg {...iconProps(size)}>
    <circle cx="12" cy="12" r="9" />
    <line x1="12" y1="8" x2="12" y2="13" />
    <circle cx="12" cy="16.5" r="0.5" fill="currentColor" />
  </svg>
);
const MessagesIcon = ({ size = 14 }) => (
  <svg {...iconProps(size)}>
    <path d="M21 11.5a8.4 8.4 0 0 1-9 8.4c-1.3 0-2.5-.3-3.6-.8L3 21l1.9-5.4A8.4 8.4 0 1 1 21 11.5z" />
  </svg>
);
const XIcon = ({ size = 12 }) => (
  <svg {...iconProps(size)}>
    <line x1="18" y1="6" x2="6" y2="18" />
    <line x1="6" y1="6" x2="18" y2="18" />
  </svg>
);
const InfoIcon = ({ size = 13 }) => (
  <svg {...iconProps(size)}>
    <circle cx="12" cy="12" r="9" />
    <line x1="12" y1="11" x2="12" y2="16" />
    <circle cx="12" cy="8" r="0.5" fill="currentColor" />
  </svg>
);
const SlidersIcon = ({ size = 13 }) => (
  <svg {...iconProps(size)}>
    <line x1="4" y1="6" x2="20" y2="6" />
    <line x1="4" y1="12" x2="20" y2="12" />
    <line x1="4" y1="18" x2="20" y2="18" />
    <circle cx="9" cy="6" r="2" fill="var(--bg)" />
    <circle cx="15" cy="12" r="2" fill="var(--bg)" />
    <circle cx="7" cy="18" r="2" fill="var(--bg)" />
  </svg>
);

Object.assign(window, {
  SidebarIcon, GearIcon, PanelRightIcon, SearchIcon, PlusIcon, MoreIcon,
  CopyIcon, RegenIcon, SendIcon, StopIcon, PaperclipIcon,
  ChevronRightIcon, ChevronDownIcon, ToolIcon, SparkleIcon, AlertIcon,
  MessagesIcon, XIcon, SlidersIcon, InfoIcon,
});
