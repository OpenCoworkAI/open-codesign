/**
 * Adaptive Power Management System (APMS)
 * Cloud Design - Industrial Grade Power Distribution
 */

export interface PowerBudget {
  total: number; // Watts
  allocated: Map<string, number>;
  reserved: number; // 10% emergency reserve
  consumed: Map<string, number>;
}

export interface PowerProfile {
  idle: number;
  normal: number;
  burst: number;
  critical: number;
}

export interface PowerAllocation {
  granted: boolean;
  watts: number;
  throttled: boolean;
  throttleRatio?: number;
  queuePosition?: number;
}

export interface ThermalStatus {
  currentTemp: number;
  status: 'normal' | 'warm' | 'hot' | 'critical';
  recommendation: string;
  heatDissipationWatts: number;
  coolingRequired: number;
}

export class AdaptivePowerManager {
  private budget: PowerBudget;
  private profiles: Map<string, PowerProfile>;
  private requestQueue: Array<{ service: string; watts: number; timestamp: number }>;

  constructor(totalPowerWatts: number = 15000) {
    this.budget = {
      total: totalPowerWatts,
      allocated: new Map(),
      reserved: totalPowerWatts * 0.1, // 1.5 kW emergency
      consumed: new Map()
    };

    this.profiles = new Map();
    this.requestQueue = [];
    this.initializePowerProfiles();
  }

  private initializePowerProfiles(): void {
    // Multi-agent orchestration
    this.profiles.set('multi-agent', {
      idle: 200,      // Standby
      normal: 1500,   // Single workflow
      burst: 4500,    // 3 parallel workflows
      critical: 6000  // Max capacity
    });

    // Verification tools
    this.profiles.set('verification', {
      idle: 100,
      normal: 800,    // Single verification
      burst: 2800,    // 10 parallel
      critical: 3500
    });

    // Browser automation (Playwright)
    this.profiles.set('browser', {
      idle: 50,
      normal: 300,    // 1 instance
      burst: 1200,    // 4 instances
      critical: 2000  // 8 instances max
    });

    // Database + Redis Cache
    this.profiles.set('datastore', {
      idle: 400,
      normal: 800,
      burst: 1200,
      critical: 1500
    });

    // Frontend SSR (Next.js)
    this.profiles.set('frontend', {
      idle: 300,
      normal: 1100,
      burst: 2200,
      critical: 3000
    });

    // Backend API (Node.js)
    this.profiles.set('backend', {
      idle: 200,
      normal: 900,
      burst: 1800,
      critical: 2500
    });
  }

  /**
   * Request power allocation with dynamic throttling
   */
  public async requestPower(
    service: string,
    requestedWatts: number
  ): Promise<PowerAllocation> {
    const currentTotal = this.getTotalConsumed();
    const available = this.budget.total - this.budget.reserved - currentTotal;

    if (requestedWatts > available) {
      // CRITICAL OVERLOAD - activate throttling
      return this.handleOverload(service, requestedWatts, available);
    }

    // Grant allocation
    const current = this.budget.consumed.get(service) || 0;
    this.budget.consumed.set(service, current + requestedWatts);

    return {
      granted: true,
      watts: requestedWatts,
      throttled: false
    };
  }

  private async handleOverload(
    service: string,
    requested: number,
    available: number
  ): Promise<PowerAllocation> {
    // Strategy 1: Throttle non-critical services
    const nonCritical = ['browser', 'frontend'];
    let freed = 0;

    for (const svc of nonCritical) {
      if (svc === service) continue;

      const current = this.budget.consumed.get(svc) || 0;
      const profile = this.profiles.get(svc);

      if (!profile) continue;

      if (current > profile.normal) {
        const reduction = current - profile.normal;
        freed += reduction;
        this.budget.consumed.set(svc, profile.normal);

        console.warn(`[APMS] Throttled ${svc}: ${current}W → ${profile.normal}W (freed ${reduction}W)`);
      }
    }

    // Strategy 2: Queue if still insufficient
    if (freed + available < requested) {
      this.requestQueue.push({
        service,
        watts: requested,
        timestamp: Date.now()
      });

      return {
        granted: false,
        watts: 0,
        throttled: true,
        queuePosition: this.requestQueue.length
      };
    }

    // Strategy 3: Partial allocation
    const grantedWatts = Math.min(requested, available + freed);
    const current = this.budget.consumed.get(service) || 0;
    this.budget.consumed.set(service, current + grantedWatts);

    return {
      granted: true,
      watts: grantedWatts,
      throttled: grantedWatts < requested,
      throttleRatio: grantedWatts / requested
    };
  }

  /**
   * Release power allocation when task completes
   */
  public releasePower(service: string, watts: number): void {
    const current = this.budget.consumed.get(service) || 0;
    this.budget.consumed.set(service, Math.max(0, current - watts));

    // Process queued requests
    this.processQueue();
  }

  private async processQueue(): Promise<void> {
    if (this.requestQueue.length === 0) return;

    const available = this.budget.total - this.budget.reserved - this.getTotalConsumed();

    // Try to satisfy queued requests
    const satisfied: number[] = [];

    for (let i = 0; i < this.requestQueue.length; i++) {
      const req = this.requestQueue[i];

      if (req.watts <= available) {
        const current = this.budget.consumed.get(req.service) || 0;
        this.budget.consumed.set(req.service, current + req.watts);
        satisfied.push(i);
        console.info(`[APMS] Satisfied queued request: ${req.service} ${req.watts}W`);
      }
    }

    // Remove satisfied requests
    for (let i = satisfied.length - 1; i >= 0; i--) {
      this.requestQueue.splice(satisfied[i], 1);
    }
  }

  private getTotalConsumed(): number {
    let total = 0;
    for (const watts of this.budget.consumed.values()) {
      total += watts;
    }
    return total;
  }

  /**
   * Thermal monitoring with physics-based modeling
   */
  public monitorThermals(): ThermalStatus {
    const totalPower = this.getTotalConsumed();
    const utilizationPercent = (totalPower / this.budget.total) * 100;

    // Thermodynamic model
    // Q = P * efficiency_loss
    // For DC-DC converters: efficiency ~92%, loss = 8%
    const heatDissipationWatts = totalPower * 0.08;

    // Temperature rise model
    // ΔT = Q * R_th where R_th = thermal resistance
    const R_thermal = 0.15; // °C/W for server chassis
    const ambientTemp = 25; // °C baseline
    const estimatedTemp = ambientTemp + (heatDissipationWatts * R_thermal);

    // Determine status
    let status: 'normal' | 'warm' | 'hot' | 'critical';
    if (estimatedTemp < 60) status = 'normal';
    else if (estimatedTemp < 75) status = 'warm';
    else if (estimatedTemp < 85) status = 'hot';
    else status = 'critical';

    // Calculate cooling requirement (CFM)
    // CFM = Q / (ρ * Cp * ΔT)
    const airDensity = 1.2; // kg/m³
    const specificHeat = 1005; // J/(kg·K)
    const tempDelta = 30; // °C (inlet to exhaust)
    const cfmRequired = (heatDissipationWatts * 1000) / (airDensity * specificHeat * tempDelta * 0.0005886); // Convert to CFM

    return {
      currentTemp: estimatedTemp,
      status,
      recommendation: this.getThermalRecommendation(status, utilizationPercent),
      heatDissipationWatts,
      coolingRequired: Math.ceil(cfmRequired)
    };
  }

  private getThermalRecommendation(status: string, utilization: number): string {
    switch (status) {
      case 'warm':
        return `Elevated temperature detected (${utilization.toFixed(1)}% utilization). Monitor closely.`;
      case 'hot':
        return `HIGH TEMPERATURE: Reduce burst workloads, increase cooling fan speed to 80%.`;
      case 'critical':
        return `EMERGENCY: Temperature critical! Throttling all non-essential services immediately.`;
      default:
        return `Operating within normal parameters (${utilization.toFixed(1)}% utilization).`;
    }
  }

  /**
   * Get current power statistics
   */
  public getStats() {
    const total = this.getTotalConsumed();
    const thermal = this.monitorThermals();

    return {
      totalWatts: total,
      availableWatts: this.budget.total - this.budget.reserved - total,
      utilizationPercent: (total / this.budget.total) * 100,
      reservedWatts: this.budget.reserved,
      queuedRequests: this.requestQueue.length,
      thermal,
      breakdown: Object.fromEntries(this.budget.consumed)
    };
  }
}
