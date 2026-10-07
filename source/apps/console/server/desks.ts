import * as Authoring from '@idhn/authoring'
import * as Contract from '@idhn/contract'
import type * as Resources from '@idhn/resources'
import type * as Horizon from '@ritaj/horizon'
import * as MUX from '@ritaj/mux'
import { refusing } from './rejections.ts'
import { draftView, resourceView, revisionView } from './views.ts'

/**
 * The resources: imported from their guards with the caller's own
 * credential, so the guard's policies decide who may import each.
 */
export class ResourceDesk {
  constructor(
    private readonly catalog: Resources.Catalog,
    private readonly importer: Resources.Importer,
  ) {}

  serve(resolvers: Horizon.Resolvers, handlers: Horizon.Handlers): void {
    resolvers.Use(Contract.Resources.List, {
      Resolve: () => Promise.resolve(this.catalog.all().map(resourceView)),
    })
    handlers
      .Use(Contract.Resources.Import, {
        Handle: (call) => refusing(() => this.import(call)),
      })
      .Use(Contract.Resources.Remove, {
        Handle: (call) =>
          refusing(() => {
            this.catalog.remove(call.Id)
            return undefined
          }),
      })
  }

  private async import(
    call: Contract.Resources.Import,
  ): Promise<Contract.Resources.ResourceView> {
    let origin: URL
    try {
      origin = new URL(call.Origin)
    } catch {
      throw new Contract.Rejected(
        'not_a_guard',
        `${call.Origin} is not a URL, such as https://shop.example.com`,
      )
    }
    const envelope = new MUX.Envelope()
    call.Credential?.PresentIn(envelope)
    const resource = await this.importer.import(
      origin,
      new Headers(envelope.Fields),
    )
    this.catalog.save(resource)
    return resourceView(resource)
  }
}

/** The policy sources: the draft everyone authors, checked and published through the builder. */
export class PolicyDesk {
  constructor(
    private readonly workspace: Authoring.Workspace,
    private readonly publishing: Authoring.Publishing,
  ) {}

  serve(resolvers: Horizon.Resolvers, handlers: Horizon.Handlers): void {
    resolvers
      .Use(Contract.Policies.Draft, {
        Resolve: () => Promise.resolve(draftView(this.workspace.draft())),
      })
      .Use(Contract.Policies.Check, {
        Resolve: () => refusing(() => this.publishing.check()),
      })
      .Use(Contract.Policies.Revisions, {
        Resolve: () =>
          Promise.resolve(
            this.workspace.revisions().map((revision) =>
              revisionView(revision)
            ),
          ),
      })
      .Use(Contract.Policies.Revision, {
        Resolve: (call) =>
          refusing(() =>
            revisionView(this.workspace.revision(call.Number), true)
          ),
      })
    handlers
      .Use(Contract.Policies.Write, {
        Handle: (call) =>
          this.edit(call, (draft) =>
            draft.write(
              Authoring.Policy.write(call.Source, call.Tests),
              call.Replacing,
            )),
      })
      .Use(Contract.Policies.Remove, {
        Handle: (call) => this.edit(call, (draft) => draft.remove(call.Name)),
      })
      .Use(Contract.Policies.Associate, {
        Handle: (call) =>
          this.edit(call, (draft) => draft.associate(call.Action, call.Policy)),
      })
      .Use(Contract.Policies.Dissociate, {
        Handle: (call) =>
          this.edit(
            call,
            (draft) => draft.dissociate(call.Action, call.Policy),
          ),
      })
      .Use(Contract.Policies.Restore, {
        Handle: (call) =>
          this.edit(
            call,
            (draft) =>
              draft.restore(this.workspace.revision(call.Number).files),
          ),
      })
      .Use(Contract.Policies.Publish, {
        Handle: (call) =>
          refusing(async () =>
            revisionView(
              await this.publishing.publish(call.From.Subject ?? 'anonymous'),
            )
          ),
      })
  }

  private edit(
    call: { BasedOn: number },
    change: (draft: Authoring.Draft) => void,
  ): Promise<Contract.Policies.DraftView> {
    return refusing(() => draftView(this.workspace.edit(call.BasedOn, change)))
  }
}

/**
 * The audit: every audit query passed on to the audit server as asked, and
 * its answer, or fault, passed back.
 */
export class AuditRelay {
  constructor(private readonly audit: Horizon.Client) {}

  serve(resolvers: Horizon.Resolvers): void {
    resolvers
      .Use(Contract.Audit.Overview, {
        Resolve: (q) =>
          this.audit.Ask(
            new Contract.Audit.Overview(q.Since, q.Until, q.Resource),
          ),
      })
      .Use(Contract.Audit.Trails, {
        Resolve: (q) =>
          this.audit.Ask(
            new Contract.Audit.Trails(
              q.Since,
              q.Until,
              q.Filters,
              q.Limit,
              q.Cursor,
            ),
          ),
      })
      .Use(Contract.Audit.Trail, {
        Resolve: (q) => this.audit.Ask(new Contract.Audit.Trail(q.RecordId)),
      })
  }
}
