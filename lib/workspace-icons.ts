import {
  Briefcase, Folder, FolderKanban, Rocket, Target, Megaphone, Users, TrendingUp,
  ShoppingCart, Package, Truck, Wrench, Layers, Globe, Star, Zap, Award,
  Building2, ClipboardList, Calendar, PieChart, BarChart3, Flag, Lightbulb,
  Palette, Code2, Database, Leaf, Apple, UtensilsCrossed, ChefHat, Factory,
  Warehouse, Boxes,
} from 'lucide-react'
import type { IconComponent } from '@/lib/icon-context'

export interface WorkspaceIconOption {
  name: string
  label: string
  Icon: IconComponent
}

export const WORKSPACE_ICONS = [
  { name: 'briefcase', label: 'Briefcase', Icon: Briefcase },
  { name: 'folder', label: 'Folder', Icon: Folder },
  { name: 'folder-kanban', label: 'Kanban', Icon: FolderKanban },
  { name: 'rocket', label: 'Rocket', Icon: Rocket },
  { name: 'target', label: 'Target', Icon: Target },
  { name: 'megaphone', label: 'Megaphone', Icon: Megaphone },
  { name: 'users', label: 'Team', Icon: Users },
  { name: 'trending-up', label: 'Growth', Icon: TrendingUp },
  { name: 'shopping-cart', label: 'Retail', Icon: ShoppingCart },
  { name: 'package', label: 'Package', Icon: Package },
  { name: 'truck', label: 'Logistics', Icon: Truck },
  { name: 'wrench', label: 'Ops', Icon: Wrench },
  { name: 'layers', label: 'Layers', Icon: Layers },
  { name: 'globe', label: 'Global', Icon: Globe },
  { name: 'star', label: 'Star', Icon: Star },
  { name: 'zap', label: 'Zap', Icon: Zap },
  { name: 'award', label: 'Award', Icon: Award },
  { name: 'building', label: 'Building', Icon: Building2 },
  { name: 'clipboard-list', label: 'Planning', Icon: ClipboardList },
  { name: 'calendar', label: 'Calendar', Icon: Calendar },
  { name: 'pie-chart', label: 'Analytics', Icon: PieChart },
  { name: 'bar-chart', label: 'Reporting', Icon: BarChart3 },
  { name: 'flag', label: 'Milestone', Icon: Flag },
  { name: 'lightbulb', label: 'Ideas', Icon: Lightbulb },
  { name: 'palette', label: 'Design', Icon: Palette },
  { name: 'code', label: 'Engineering', Icon: Code2 },
  { name: 'database', label: 'Data', Icon: Database },
  { name: 'leaf', label: 'Sustainability', Icon: Leaf },
  { name: 'apple', label: 'Nutrition', Icon: Apple },
  { name: 'utensils', label: 'Food', Icon: UtensilsCrossed },
  { name: 'chef-hat', label: 'Kitchen', Icon: ChefHat },
  { name: 'factory', label: 'Production', Icon: Factory },
  { name: 'warehouse', label: 'Warehouse', Icon: Warehouse },
  { name: 'boxes', label: 'Inventory', Icon: Boxes },
] as unknown as WorkspaceIconOption[]

export const DEFAULT_WORKSPACE_ICON = 'folder'

const iconLookup: Record<string, IconComponent> = Object.fromEntries(
  WORKSPACE_ICONS.map(o => [o.name, o.Icon])
)

export function getWorkspaceIcon(name?: string | null): IconComponent {
  return (name && iconLookup[name]) || (Folder as unknown as IconComponent)
}
