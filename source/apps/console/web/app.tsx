import { useEffect, useState } from 'react'
import {
  CommandMenu,
  CommandMenuDialog,
  CommandMenuEmpty,
  CommandMenuInput,
  CommandMenuList,
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarInset,
  SidebarInsetTopbar,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarProvider,
  SidebarWorkspaceHeader,
  TooltipProvider,
  useIcon,
  useIcons,
  WorkspaceTile,
} from '@ritaj/ui'
import { useConsole } from './console-provider.tsx'
import { useDraft } from './draft.ts'
import { Notice } from './components/notice.tsx'
import { GROUPS, type Screen, ScreenOf, SCREENS } from './screens.ts'
import { Associations } from './screens/associations.tsx'
import { Audit } from './screens/audit.tsx'
import { Policies } from './screens/policies.tsx'
import { Resources } from './screens/resources.tsx'

/** The screen the URL's hash names, following it as it changes. */
function useScreen(): Screen {
  const [screen, setScreen] = useState(() => ScreenOf(location.hash))
  useEffect(() => {
    const onHash = () => setScreen(ScreenOf(location.hash))
    addEventListener('hashchange', onHash)
    return () => removeEventListener('hashchange', onHash)
  }, [])
  return screen
}

/** The console: a sidebar of screens, and the screen it shows. */
export function App() {
  const console = useConsole()
  const screen = useScreen()
  const [refresh, setRefresh] = useState(0)
  const [signedOut, setSignedOut] = useState(false)
  const [palette, setPalette] = useState(false)
  // Policies and associations both change the one draft.
  const draft = useDraft(refresh)

  useEffect(() => {
    const subscription = console.OnSessionRefused.Do(() => setSignedOut(true))
    return () => subscription.Dispose()
  }, [console])

  return (
    <TooltipProvider>
      <SidebarProvider peek='hover'>
        <ConsoleSidebar
          active={screen}
          onRefresh={() => setRefresh((n) => n + 1)}
          onSearch={() => setPalette(true)}
        />
        <SidebarInset>
          <SidebarInsetTopbar>
            <h1 className='text-title font-medium text-foreground'>
              {screen.label}
            </h1>
            <p className='ml-2 hidden text-body text-muted-foreground md:block'>
              {screen.description}
            </p>
          </SidebarInsetTopbar>
          <main className='mx-auto grid w-full max-w-6xl gap-6 p-4 md:p-6'>
            {signedOut && (
              <Notice tone='warning'>
                Your session ended: sign in again, then refresh.
              </Notice>
            )}
            {screen.id === 'resources' && <Resources refresh={refresh} />}
            {screen.id === 'policies' && <Policies state={draft} />}
            {screen.id === 'associations' && (
              <Associations refresh={refresh} state={draft} />
            )}
            {screen.id === 'audit' && <Audit refresh={refresh} />}
          </main>
        </SidebarInset>
      </SidebarProvider>
      <Palette
        open={palette}
        onOpenChange={setPalette}
        onGo={(next) => (location.hash = `#/${next.id}`)}
      />
    </TooltipProvider>
  )
}

function ConsoleSidebar(
  { active, onRefresh, onSearch }: {
    active: Screen
    onRefresh(): void
    onSearch(): void
  },
) {
  const icons = useIcons()
  const SearchIcon = useIcon('search')
  const RefreshIcon = useIcon('rotate-ccw')
  return (
    <Sidebar variant='inset'>
      <SidebarHeader>
        <SidebarWorkspaceHeader
          name='idhn'
          tile={<WorkspaceTile>I</WorkspaceTile>}
        />
      </SidebarHeader>
      <SidebarContent>
        {GROUPS.map(({ group, label }) => (
          <SidebarGroup key={group}>
            <SidebarGroupLabel>{label}</SidebarGroupLabel>
            <SidebarMenu>
              {SCREENS.filter((screen) => screen.group === group).map((
                screen,
              ) => (
                <SidebarMenuItem key={screen.id}>
                  <SidebarMenuButton
                    icon={icons[screen.icon]}
                    isActive={screen.id === active.id}
                    onClick={() => (location.hash = `#/${screen.id}`)}
                  >
                    {screen.label}
                  </SidebarMenuButton>
                </SidebarMenuItem>
              ))}
            </SidebarMenu>
          </SidebarGroup>
        ))}
      </SidebarContent>
      <SidebarFooter>
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton icon={SearchIcon} onClick={onSearch}>
              Go to…
            </SidebarMenuButton>
          </SidebarMenuItem>
          <SidebarMenuItem>
            <SidebarMenuButton icon={RefreshIcon} onClick={onRefresh}>
              Refresh
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarFooter>
    </Sidebar>
  )
}

/** ⌘K: jump to any screen by name. */
function Palette(
  { open, onOpenChange, onGo }: {
    open: boolean
    onOpenChange(open: boolean): void
    onGo(screen: Screen): void
  },
) {
  const icons = useIcons()
  const items = SCREENS.map((screen) => ({
    value: screen.id,
    label: screen.label,
    description: screen.description,
    icon: icons[screen.icon],
    group: GROUPS.find(({ group }) => group === screen.group)?.label,
    onSelect: () => onGo(screen),
  }))
  return (
    <CommandMenuDialog
      open={open}
      onOpenChange={onOpenChange}
      title='Go to a screen'
    >
      <CommandMenu items={items}>
        <CommandMenuInput placeholder='Go to…' />
        <CommandMenuList />
        <CommandMenuEmpty>No screen by that name</CommandMenuEmpty>
      </CommandMenu>
    </CommandMenuDialog>
  )
}
