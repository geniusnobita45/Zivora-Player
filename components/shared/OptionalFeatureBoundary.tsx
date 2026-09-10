"use client";

import { Component, type ReactNode } from "react";
import { z } from "zod";
import type {
  DegradationCapability,
  DegradationManager,
} from "@/services/degradation/DegradationManager";

const BoundaryPropsSchema = z.object({ capability: z.string().min(1) });

export class OptionalFeatureBoundary extends Component<
  {
    capability: DegradationCapability;
    manager: DegradationManager;
    children: ReactNode;
    onError?: () => void;
    fallback?: ReactNode;
  },
  { failed: boolean }
> {
  state = { failed: false };
  private unsubscribe?: () => void;

  static getDerivedStateFromError() {
    return { failed: true };
  }

  componentDidMount(): void {
    this.unsubscribe = this.props.manager.subscribe(() => {
      if (
        this.state.failed &&
        this.props.manager.getSnapshot().health[this.props.capability] === "healthy"
      )
        this.setState({ failed: false });
    });
  }

  componentDidCatch(): void {
    try {
      this.props.onError?.();
    } catch {
      // A failure callback is part of the optional feature and is isolated too.
    }
    const parsed = BoundaryPropsSchema.safeParse({ capability: this.props.capability });
    if (parsed.success)
      this.props.manager.reportUnavailable(this.props.capability, () => true, z.literal(true));
  }

  componentWillUnmount(): void {
    this.unsubscribe?.();
  }

  render(): ReactNode {
    return this.state.failed ? (this.props.fallback ?? null) : this.props.children;
  }
}
