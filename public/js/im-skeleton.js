/**
 * Skeletons de carga para Gestión de Campos / Inmobiliaria.
 */
(function (global) {
    function times(n, fn) {
        var out = '';
        for (var i = 0; i < n; i++) out += fn(i);
        return out;
    }

    function projectCards(n) {
        n = n || 6;
        return times(n, function () {
            return '<div class="im-sk-proj">' +
                '<div class="im-sk-proj-cover"></div>' +
                '<div class="im-sk-proj-body">' +
                '<div class="im-sk im-sk-line" style="width:70%;height:16px;margin-bottom:10px;"></div>' +
                '<div class="im-sk im-sk-line" style="width:45%;height:12px;margin-bottom:14px;"></div>' +
                '<div style="display:flex;gap:8px;">' +
                '<div class="im-sk im-sk-pill"></div><div class="im-sk im-sk-pill"></div><div class="im-sk im-sk-pill"></div>' +
                '</div></div></div>';
        });
    }

    function tableRows(cols, rows) {
        cols = cols || 6;
        rows = rows || 8;
        return times(rows, function () {
            var cells = times(cols, function (i) {
                var w = i === 0 ? '65%' : (i === cols - 1 ? '30%' : '50%');
                return '<td><div class="im-sk im-sk-line" style="width:' + w + ';height:12px;"></div></td>';
            });
            return '<tr class="im-sk-tr">' + cells + '</tr>';
        });
    }

    function tableWrap(cols, rows) {
        return '<div class="im-sk-table-wrap"><table class="im-sk-table"><tbody>' +
            tableRows(cols, rows) + '</tbody></table></div>';
    }

    function kpis(n) {
        n = n || 8;
        return '<div class="im-sk-kpi-grid">' + times(n, function () {
            return '<div class="im-sk-kpi">' +
                '<div class="im-sk im-sk-line" style="width:40%;height:10px;margin-bottom:12px;"></div>' +
                '<div class="im-sk im-sk-line" style="width:55%;height:22px;margin-bottom:10px;"></div>' +
                '<div class="im-sk im-sk-line" style="width:70%;height:10px;"></div>' +
                '</div>';
        }) + '</div>';
    }

    function listRows(n) {
        n = n || 6;
        return '<div class="im-sk-list">' + times(n, function () {
            return '<div class="im-sk-list-row">' +
                '<div class="im-sk im-sk-avatar"></div>' +
                '<div style="flex:1;min-width:0;">' +
                '<div class="im-sk im-sk-line" style="width:55%;height:13px;margin-bottom:8px;"></div>' +
                '<div class="im-sk im-sk-line" style="width:35%;height:10px;"></div>' +
                '</div>' +
                '<div class="im-sk im-sk-pill"></div>' +
                '</div>';
        }) + '</div>';
    }

    function parcelas(n) {
        n = n || 16;
        return '<div class="im-sk-parcelas">' + times(n, function () {
            return '<div class="im-sk-parcela">' +
                '<div class="im-sk im-sk-line" style="width:40%;height:12px;margin:0 auto 8px;"></div>' +
                '<div class="im-sk im-sk-line" style="width:60%;height:10px;margin:0 auto;"></div>' +
                '</div>';
        }) + '</div>';
    }

    function docs(n) {
        n = n || 4;
        return '<div class="im-sk-docs">' + times(n, function () {
            return '<div class="im-sk-doc">' +
                '<div class="im-sk im-sk-icon"></div>' +
                '<div style="flex:1;">' +
                '<div class="im-sk im-sk-line" style="width:60%;height:12px;margin-bottom:6px;"></div>' +
                '<div class="im-sk im-sk-line" style="width:30%;height:10px;"></div>' +
                '</div></div>';
        }) + '</div>';
    }

    function card() {
        return '<div class="im-sk-card">' +
            '<div class="im-sk-card-head"></div>' +
            '<div class="im-sk-card-body">' +
            '<div class="im-sk im-sk-block"></div>' +
            '<div class="im-sk im-sk-block"></div>' +
            '<div class="im-sk im-sk-line" style="width:55%;"></div>' +
            '</div></div>';
    }

    function cartera() {
        return '<div class="im-sk-cartera">' +
            kpis(8) +
            '<div class="im-sk-panel" style="margin-top:16px;">' +
            '<div class="im-sk im-sk-line" style="width:30%;height:14px;margin-bottom:14px;"></div>' +
            listRows(4) +
            '</div></div>';
    }

    global.IMSkeleton = {
        projectCards: projectCards,
        tableRows: tableRows,
        tableWrap: tableWrap,
        kpis: kpis,
        listRows: listRows,
        parcelas: parcelas,
        docs: docs,
        card: card,
        cartera: cartera
    };
})(typeof window !== 'undefined' ? window : this);
