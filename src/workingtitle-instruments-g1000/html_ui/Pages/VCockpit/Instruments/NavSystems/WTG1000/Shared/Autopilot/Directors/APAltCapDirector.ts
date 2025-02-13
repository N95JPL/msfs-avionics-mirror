/// <reference types="msfstypes/JS/simvar" />

import { MathUtils, UnitType } from 'msfssdk';
import { EventBus, SimVarValueType } from 'msfssdk/data';
import { ADCEvents, GNSSEvents } from 'msfssdk/instruments';
import { PlaneDirector, DirectorState, APValues } from 'msfssdk/autopilot';

/**
 * An altitude capture autopilot director.
 */
export class APAltCapDirector implements PlaneDirector {

  public state: DirectorState;

  /** A callback called when the director activates. */
  public onActivate?: () => void;

  /** A callback called when the director arms. */
  public onArm?: () => void;

  private groundSpeed = 0;
  private capturedAltitude = 0;
  private indicatedAltitude = 0;
  private verticalSpeed = 0;
  private initialFpa = 0;
  private selectedAltitude = 0;

  /**
   * Creates an instance of the LateralDirector.
   * @param bus The event bus to use with this instance.
   * @param apValues are the ap selected values for the autopilot.
   */
  constructor(private readonly bus: EventBus, private readonly apValues: APValues) {
    this.state = DirectorState.Inactive;

    this.bus.getSubscriber<GNSSEvents>().on('ground_speed').withPrecision(0).handle((g) => {
      this.groundSpeed = g;
    });

    const adc = this.bus.getSubscriber<ADCEvents>();
    adc.on('alt').withPrecision(0).handle((alt) => {
      this.indicatedAltitude = alt;
    });
    adc.on('vs').withPrecision(0).handle((vs) => {
      this.verticalSpeed = vs;
    });
    this.apValues.capturedAltitude.sub((cap) => {
      this.capturedAltitude = Math.round(cap);
    });
    this.apValues.selectedAltitude.sub((alt) => {
      this.selectedAltitude = alt;
    });
  }

  /**
   * Activates this director.
   */
  public activate(): void {
    this.state = DirectorState.Active;
    if (this.onActivate !== undefined) {
      this.onActivate();
    }
    this.setCaptureFpa(this.verticalSpeed);
    SimVar.SetSimVarValue('AUTOPILOT ALTITUDE LOCK', 'Bool', true);
  }

  /**
   * Arms this director.
   * This director has no armed mode, so it activates immediately.
   */
  public arm(): void {
    this.state = DirectorState.Armed;
    if (this.onArm !== undefined) {
      this.onArm();
    }
  }

  /**
   * Deactivates this director.
   * @param captured is whether the altitude was captured.
   */
  public deactivate(captured = false): void {
    this.state = DirectorState.Inactive;
    if (!captured) {
      SimVar.SetSimVarValue('AUTOPILOT ALTITUDE LOCK', 'Bool', false);
    }
    //this.capturedAltitude = 0;
  }

  /**
   * Updates this director.
   */
  public update(): void {
    if (this.state === DirectorState.Active) {
      this.captureAltitude(this.capturedAltitude);
    }
    if (this.state === DirectorState.Armed) {
      this.tryActivate();
    }
  }

  /**
   * Attempts to activate altitude capture.
   */
  private tryActivate(): void {
    const deviationFromTarget = Math.abs(this.selectedAltitude - this.indicatedAltitude);

    if (deviationFromTarget <= Math.abs(this.verticalSpeed / 6)) {
      this.apValues.capturedAltitude.set(Math.round(this.selectedAltitude));
      this.activate();
    }
  }

  /**
   * Holds a captured altitude.
   * @param targetAltitude is the captured targed altitude
   */
  private captureAltitude(targetAltitude: number): void {
    const altCapDeviation = this.indicatedAltitude - targetAltitude;
    const altCapPitchPercentage = Math.min(Math.abs(altCapDeviation) / 100, 1);
    const desiredPitch = (this.initialFpa * altCapPitchPercentage);
    const aoa = SimVar.GetSimVarValue('INCIDENCE ALPHA', SimVarValueType.Degree);
    const targetPitch = aoa + MathUtils.clamp(desiredPitch, -6, 6);
    this.setPitch(targetPitch);
  }

  /**
   * Sets the initial capture FPA from the current vs value when capture is initiated.
   * @param vs target vertical speed.
   */
  private setCaptureFpa(vs: number): void {
    if (Math.abs(vs) < 400) {
      const altCapDeviation = this.indicatedAltitude - this.selectedAltitude;
      vs = altCapDeviation > 0 ? -400 : 400;
    }
    this.initialFpa = this.getFpa(UnitType.NMILE.convertTo(this.groundSpeed / 60, UnitType.FOOT), vs);
  }

  /**
   * Gets a desired fpa.
   * @param distance is the distance traveled per minute.
   * @param altitude is the vertical speed per minute.
   * @returns The desired pitch angle.
   */
  private getFpa(distance: number, altitude: number): number {
    return UnitType.RADIAN.convertTo(Math.atan(altitude / distance), UnitType.DEGREE);
  }

  /**
   * Sets the desired AP pitch angle.
   * @param targetPitch The desired AP pitch angle.
   */
  private setPitch(targetPitch: number): void {
    if (isFinite(targetPitch)) {
      SimVar.SetSimVarValue('AUTOPILOT PITCH HOLD REF', SimVarValueType.Degree, -targetPitch);
    }
  }
}