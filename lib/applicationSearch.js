/* Start 与独立搜索共用应用列表、匹配及启动动画入口。 */
import Shell from 'gi://Shell';
import {noteLaunch} from './windowMotion.js';
import {matchesQuery} from './searchMatch.js';

export function installedApplications(order) {
    const system = Shell.AppSystem.get_default();
    const apps = system.get_installed().filter(info => info.should_show())
        .map(info => system.lookup_app(info.get_id())).filter(Boolean)
        .sort((a, b) => order.compare(a.get_name(), b.get_name()));
    order.prime(apps.map(app => app.get_name()));
    return apps;
}

export function matchingApplications(query, apps) {
    return apps.filter(app => {
        const info = app.get_app_info();
        return matchesQuery(query, [app.get_name(), info?.get_description(), info?.get_executable(),
            ...(info?.get_keywords?.() ?? [])]);
    });
}

export function activateApplication(app, source, beforeLaunch) {
    noteLaunch(app, source);
    beforeLaunch?.();
    app.activate_full(-1, global.get_current_time());
}
