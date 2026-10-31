// Builders for the client/server protocol. A command pairs a request with the
// reply it produces; an event is a server push with no request. Wire `type`
// tags, envelope unions and the ClientTag/ServerTag lookups are all derived
// from these definitions in ./index.ts — nothing about a message is declared
// twice.

import { z } from 'zod';

type Shape = z.ZodRawShape;
type Body = Shape | z.ZodObject<Shape>;

type ShapeOf<B extends Body> = B extends z.ZodObject<infer S> ? S : B extends Shape ? B : never;

function asObject(body: Body): z.ZodObject<Shape> {
    return body instanceof z.ZodObject ? body : z.object(body);
}

/** Reply variants discriminated on one field (`outcome` by default), each stamped with the reply's `type`. */
export class Variants<D extends string, V extends Record<string, Body>> {
    constructor(
        readonly discriminator: D,
        readonly variants: V,
    ) {}
}

export function variants<D extends string, V extends Record<string, Body>>(
    discriminator: D,
    defs: V,
): Variants<D, V> {
    return new Variants(discriminator, defs);
}

export function outcomes<V extends Record<string, Body>>(defs: V): Variants<'outcome', V> {
    return new Variants('outcome', defs);
}

type AnyVariants = Variants<string, Record<string, Body>>;

type Stamped<N extends string, B extends Body> = z.ZodObject<
    ShapeOf<B> & { type: z.ZodLiteral<N> }
>;

type StampedVariant<
    N extends string,
    D extends string,
    K extends string,
    B extends Body,
> = z.ZodObject<ShapeOf<B> & { type: z.ZodLiteral<N> } & { [P in D]: z.ZodLiteral<K> }>;

type VariantUnion<N extends string, D extends string, V extends Record<string, Body>> = {
    [K in keyof V & string]: StampedVariant<N, D, K, V[K]>;
}[keyof V & string];

/** The zod schema of a message named N with body B: an object, or a discriminated union of objects. */
export type Envelope<N extends string, B> =
    B extends Variants<infer D, infer V>
        ? z.ZodDiscriminatedUnion<VariantUnion<N, D, V>[], D>
        : B extends Body
          ? Stamped<N, B>
          : never;

/** A named server→client message: an event, a standalone reply, or a command's reply. */
export type MessageDef<N extends string, S extends z.ZodType> = {
    readonly name: N;
    readonly Schema: S;
};

function buildEnvelope<N extends string, B extends Body | AnyVariants>(
    name: N,
    body: B,
): Envelope<N, B> {
    const typeLiteral = z.literal(name);
    if (body instanceof Variants) {
        const members = Object.entries(body.variants).map(([value, variant]) =>
            asObject(variant).extend({
                type: typeLiteral,
                [body.discriminator]: z.literal(value),
            }),
        );
        return z.discriminatedUnion(
            body.discriminator,
            members as [(typeof members)[number], ...(typeof members)[number][]],
        ) as unknown as Envelope<N, B>;
    }
    return asObject(body as Body).extend({ type: typeLiteral }) as unknown as Envelope<N, B>;
}

export function defineEvent<N extends string, B extends Body>(
    name: N,
    body: B,
): MessageDef<N, Envelope<N, B>> {
    return { name, Schema: buildEnvelope(name, body) };
}

/** A reply shared by several commands, or one whose name doesn't follow `${command}Result`. */
export function defineReply<N extends string, B extends Body | AnyVariants>(
    name: N,
    body: B,
): MessageDef<N, Envelope<N, B>> {
    return { name, Schema: buildEnvelope(name, body) };
}

type AnyMessageDef = MessageDef<string, z.ZodType>;

export type CommandDef<N extends string, Req extends z.ZodType, R extends AnyMessageDef | null> = {
    readonly name: N;
    readonly Request: Req;
    readonly reply: R;
};

type ReplyInput = Body | AnyVariants | AnyMessageDef | null;

type ResolvedReply<N extends string, R extends ReplyInput> = R extends AnyMessageDef
    ? R
    : R extends Body | AnyVariants
      ? MessageDef<`${N}Result`, Envelope<`${N}Result`, R>>
      : null;

function isMessageDef(x: unknown): x is AnyMessageDef {
    return typeof x === 'object' && x !== null && 'Schema' in x && 'name' in x;
}

/**
 * `reply` is a body shape (reply tag becomes `${name}Result`), `outcomes(...)`
 * variants, an existing reply/event definition to share, or null for commands
 * that produce no reply.
 */
export function defineCommand<N extends string, Req extends Body, R extends ReplyInput>(
    name: N,
    def: { request: Req; reply: R },
): CommandDef<N, Envelope<N, Req>, ResolvedReply<N, R>> {
    const Request = buildEnvelope(name, def.request);
    let reply: AnyMessageDef | null;
    if (def.reply === null) reply = null;
    else if (isMessageDef(def.reply)) reply = def.reply;
    else reply = defineReply(`${name}Result`, def.reply);
    return { name, Request, reply: reply as ResolvedReply<N, R> };
}
